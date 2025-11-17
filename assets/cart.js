class GiftWrapButton extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('click', async (event) => {
      event.preventDefault();

      const giftWrapVariantId = this.dataset.giftWrapVariantId;
      const sectionId = this.dataset.sectionId;

      if (!giftWrapVariantId) {
        console.error('Gift wrap variant ID not set.');
        return;
      }

      const spinner = this.querySelector('.loading__spinner');
      if (spinner) {
        this.classList.add('loading');
        spinner.classList.remove('hidden');
      }
      this.setAttribute('aria-busy', 'true');

      try {
        await this.addGiftWrapToCart(giftWrapVariantId, sectionId);
      } catch (e) {
        console.error('Error adding gift wrap:', e);
      } finally {
        this.removeAttribute('aria-busy');
        if (spinner) {
          this.classList.remove('loading');
          spinner.classList.add('hidden');
        }
      }
    });
  }

  updateSections(sections) {
    const cartItemsComponent =
      document.querySelector('cart-drawer-items') ||
      document.querySelector('cart-items-component');
    
    if (cartItemsComponent && typeof cartItemsComponent.updateSections === 'function') {
      cartItemsComponent.updateSections(sections);
    } else {
      console.error('GiftWrapButton: No cart items component found or updateSections method not available');
    }
  }

  renderSection(sectionId, html) {
    const cartItemsComponent =
      document.querySelector('cart-drawer-items') ||
      document.querySelector('cart-items-component');
    
    if (cartItemsComponent && typeof cartItemsComponent.renderSection === 'function') {
      cartItemsComponent.renderSection(sectionId, html);
    } else {
      console.error('GiftWrapButton: No cart items component found or renderSection method not available');
    }
  }

  async addGiftWrapToCart(giftWrapVariantId, sectionId) {
    try {
      const config = fetchConfig('json');
      const fetchOptions = {
        ...config,
        body: JSON.stringify({
          items: [{ id: giftWrapVariantId, quantity: 1 }],
          ...(sectionId ? { sections: [sectionId] } : {}),
        }),
      };

      const response = await fetch(`${routes.cart_add_url}`, fetchOptions);
      const data = await response.json();

      document.dispatchEvent(new CustomEvent('GiftWrapUpdateEvent', { detail: { data, id: this.id } }));

      if (data.sections) {
        this.updateSections(data.sections);
      } else if (sectionId && data.sections && data.sections[sectionId]) {
        this.renderSection(sectionId, data.sections[sectionId]);
      }
    } catch (error) {
      throw error;
    }
  }
}
if (!customElements.get('gift-wrap-button')) customElements.define('gift-wrap-button', GiftWrapButton);

class CartItemsComponent extends HTMLElement {
  constructor() {
    super();
    this.handleQuantityUpdate = this.handleQuantityUpdate.bind(this);
    this.handleCartUpdate = this.handleCartUpdate.bind(this);
    this.handleDiscountUpdate = this.handleDiscountUpdate.bind(this);

    this.addEventListener('onLineItemRemove', (event) => {
      if (event?.detail?.line) {
        this.onLineItemRemove(event.detail.line);
      }
    });
  }

  #onAnimationEnd(elements, callback, options = { subtree: true }) {
    const animations = Array.isArray(elements)
      ? elements.flatMap((element) => element.getAnimations(options))
      : elements.getAnimations(options);
    const animationPromises = animations.reduce((acc, animation) => {
      if (animation.timeline instanceof DocumentTimeline) {
        acc.push(animation.finished);
      }
      return acc;
    }, []);
    return Promise.allSettled(animationPromises).then(callback);
  }

  #prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  connectedCallback() {
    document.addEventListener('cart:updated', this.handleCartUpdate);
    document.addEventListener('discount:update', this.handleDiscountUpdate);
    document.addEventListener('quantity-selector:update', this.handleQuantityUpdate);
  }

  disconnectedCallback() {
    document.removeEventListener('cart:updated', this.handleCartUpdate);
    document.removeEventListener('discount:update', this.handleDiscountUpdate);
    document.removeEventListener('quantity-selector:update', this.handleQuantityUpdate);
  }

  async handleQuantityUpdate(event) {
    const { quantity, cartLine } = event.detail || {};
    if (typeof cartLine === 'undefined' || cartLine === null) return;

    if (quantity === 0) {
      this.onLineItemRemove(cartLine);
      return;
    }

    const lineItemRow = this.querySelector(`.cart-items__table-row[data-line="${cartLine}"]`);
    if (lineItemRow) {
      const textComponent = lineItemRow.querySelectorAll?.('text-loader-component');
      textComponent?.forEach?.((component) => {
        component.spinner();
      });
    }

    await this.updateQuantity({
      line: cartLine,
      quantity,
      action: 'change',
    });
  }

  async onLineItemRemove(line) {
    const cartItemRowToRemove = this.querySelector(`.cart-items__table-row[data-line="${line}"]`);
    if (!cartItemRowToRemove) {
      await this.updateQuantity({
        line,
        quantity: 0,
        action: 'clear',
      });
      return;
    }

    let rowsToRemove = [cartItemRowToRemove];
    const allRows = Array.from(this.querySelectorAll(`.cart-items__table-row`));
    if (cartItemRowToRemove.dataset.key) {
      rowsToRemove = rowsToRemove.concat(
        allRows.filter(
          (row) => row.dataset.parentKey === cartItemRowToRemove.dataset.key
        )
      );
    }

    for (const row of rowsToRemove) {
      const remove = () => row.remove();
      if (this.#prefersReducedMotion()) {
        remove();
      } else {
        row.style.setProperty('--row-height', `${row.clientHeight}px`);
        row.classList.add('removing');
        await this.#onAnimationEnd(row, remove);
      }
    }

    await this.updateQuantity({
      line,
      quantity: 0,
      action: 'clear',
    });
  }

  createAbortController() {
    if (this.activeFetch) {
      this.activeFetch.abort();
    }
    const abortController = new AbortController();
    this.activeFetch = abortController;
    return abortController;
  }

  async getSectionHTML(sectionId, url = window.location.href) {
    const targetUrl = new URL(url);
    targetUrl.searchParams.set('section_id', sectionId);

    const response = await fetch(targetUrl, { cache: 'no-store' });
    return await response.text();
  }

  async renderSection(sectionId) {
    const html = await this.getSectionHTML(sectionId);
    this.#updateSingleSection(sectionId, html);
  }

  #findTargetSection(sectionId) {
    return document.querySelector(`[data-section-id="${sectionId}"] .section--main-cart`);
  }

  #findNewSection(sectionId, html) {
    const newDOM = new DOMParser().parseFromString(html, 'text/html');
    return newDOM.querySelector(`[data-section-id="${sectionId}"] .section--main-cart`);
  }

  #updateSingleSection(sectionId, html) {
    const target = this.#findTargetSection(sectionId);
    const newSection = this.#findNewSection(sectionId, html);

    if (!target || !newSection) {
      return;
    }

    Array.from(newSection.children).forEach(child => {
      if (
        !child.classList.contains('cart-page__message') &&
        !child.classList.contains('cart-page__shipping')
      ) {
        let targetChild = null;
        if (child.id) {
          targetChild = target.querySelector(`#${child.id}`);
        }
        if (!targetChild && child.classList.length > 0) {
          targetChild = target.querySelector(`.${child.classList[0]}`);
        }
        if (targetChild) {
          targetChild.replaceWith(child.cloneNode(true));
        }
      }
    });
  }

  async updateQuantity(config) {
    let cartPerformanceUpdateMarker = null;
    const cartPerf = /** @type {any} */ (window).cartPerformance || {};
    if (
      typeof cartPerf !== 'undefined' &&
      cartPerf &&
      typeof cartPerf.createStartingMarker === 'function'
    ) {
      cartPerformanceUpdateMarker = cartPerf.createStartingMarker(`${config.action}:user-action`);
    }

    this.classList.add('cart-items-disabled');

    const { line, quantity } = config;
    const cartTotal = this.querySelectorAll('.cart-total text-loader-component');

    const cartItemsComponents = document.querySelectorAll('cart-items-component, cart-drawer-items');
    const sectionsToUpdate = new Set();
    cartItemsComponents.forEach((item) => {
      if (item.dataset.sectionId) sectionsToUpdate.add(item.dataset.sectionId);
    });

    if (sectionsToUpdate.size === 0 && window.Shopify?.designMode) {
      const possibleSection = document.querySelector('[data-section-id*="cart"]');
      if (possibleSection) sectionsToUpdate.add(possibleSection.dataset.sectionId);
    }

    const abortController = this.createAbortController();

    const bodyObj = {
      line,
      quantity,
      sections: Array.from(sectionsToUpdate).join(','),
      sections_url: window.location.pathname,
    };

    const fetchOptions = {
      ...fetchConfig('json'),
      body: JSON.stringify(bodyObj),
      signal: abortController.signal,
    };

    cartTotal?.forEach((component) => {
      component.shimmer();
    });

    try {
      const response = await fetch(`${routes.cart_change_url}`, fetchOptions);
      const json = await response.json();
      if (json.errors) {
        resetSpinner(this);
        resetShimmer(this);
        this.#handleCartError(line, json);
        return;
      }

      if (window.Shopify.designMode) {
        for (const id of sectionsToUpdate) {
          await this.renderSection(id);
        }
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: json }));
        return;
      }

      if (json.sections) {
        this.updateSections(json.sections);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: json }));
      }

      // --- START ADDED CODE: update cart count and bubbles like in global.js ---
      // This ensures the cart count, text, and bubbles get updated after quantity change (like @file_context_0)
      if (json.item_count !== undefined) {
        const cartCountEls = document.querySelectorAll('[data-cart-count]');
        cartCountEls.forEach(function(el) {
          el.textContent = json.item_count;
        });

        // If cart count >= 100, show special bubble string
        if (json.item_count >= 100) {
          const bubbleCountEls = document.querySelectorAll('.cart-count-bubble [data-cart-count]');
          bubbleCountEls.forEach(function(el) {
            el.textContent = window.cartStrings.item_99;
          });
        }

        // Update cart text
        const cartTextEls = document.querySelectorAll('[data-cart-text]');
        cartTextEls.forEach(function(el) {
          if (json.item_count == 1) {
            el.textContent = window.cartStrings.item.replace('[count]', json.item_count);
          } else {
            el.textContent = window.cartStrings.items.replace('[count]', json.item_count);
          }
        });
      }
      // --- END ADDED CODE ---

    } catch (err) {
      console.error(err);
    } finally {
      this.classList.remove('cart-items-disabled');
      const cartPerf = /** @type {any} */ (window).cartPerformance || {};
      if (
        typeof cartPerf !== 'undefined' &&
        cartPerf &&
        typeof cartPerf.measureFromMarker === 'function' &&
        cartPerformanceUpdateMarker
      ) {
        cartPerf.measureFromMarker(`${config.action}:user-action`, cartPerformanceUpdateMarker);
      }
    }
  }

  updateSections(sections) {
    if (!sections) return;

    resetSpinner(this);
    resetShimmer(this);

    // Process all sections efficiently using the optimized method
    Object.entries(sections).forEach(([id, html]) => {
      this.#updateSingleSection(id, html);
    });
  }

  /**
   * Handles the discount update.
   * @param {DiscountUpdateEvent} event - The event.
   */
  handleDiscountUpdate = (event) => {
    this.handleCartUpdate(event);
  };

  /**
   * Handles the cart error.
   * @param {number} line - The line.
   * @param {Object} json - The parsed response text.
   * @param {string} json.errors - The errors.
   */
  #handleCartError = (line, json) => {
    const quantitySelector = this.querySelector(`.cart-items__table-row[data-line="${line}"]`);
    const quantityInput = quantitySelector?.querySelector('input');
    if (!quantityInput) {
      console.error('Quantity input not found');
      return;
    }

    quantityInput.value = quantityInput.defaultValue;

    const cartItemError = this.querySelector(`.cart-items__table-row[data-line="${line}"] .cart-item__error-text`);
    const cartItemErrorContainer = this.querySelector(`.cart-items__table-row[data-line="${line}"] .cart-item__error`);

    if (!(cartItemError instanceof HTMLElement)) {
      console.error('Cart item error not found');
      return;
    }
    if (!(cartItemErrorContainer instanceof HTMLElement)) {
      console.error('Cart item error container not found');
      return;
    }

    cartItemError.textContent = json.errors;
    cartItemErrorContainer.classList.remove('hidden');
  };

  /**
   * Handles the cart update.
   *
   * @param {DiscountUpdateEvent | CustomEvent | CartAddEvent} event
   */
  handleCartUpdate(event) {
    let sections = undefined;
    if (event?.detail?.data?.sections) {
      sections = event.detail.data.sections;
    } else if (event?.detail?.sections) {
      sections = event.detail.sections;
    }
    
    if (sections) {
      this.updateSections(sections);
    }
  };

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset || {};
    if (!sectionId) throw new Error('Section id missing');
    return sectionId;
  }
}
if (!customElements.get('cart-items-component')) customElements.define('cart-items-component', CartItemsComponent);

class CartDrawerItems extends CartItemsComponent {
  constructor() {
    super();
    // CartDrawerItems inherits all functionality from CartItemsComponent
    // but we can add drawer-specific logic here if needed
  }

  /**
   * Override the sectionId getter to handle drawer-specific section ID
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset || {};
    if (!sectionId) {
      // Fallback to parent cart drawer section ID
      const cartDrawer = this.closest('cart-drawer');
      if (cartDrawer && cartDrawer.dataset.sectionId) {
        return cartDrawer.dataset.sectionId;
      }
      throw new Error('Section id missing for cart drawer items');
    }
    return sectionId;
  }

  /**
   * Optimized method to find target section element
   * @param {string} sectionId - The section ID
   * @returns {Element|null} The target element
   */
  #findTargetSection(sectionId) {
    return document.querySelector(`[data-section-id="${sectionId}"] .section--main-cart`);
  }

  /**
   * Optimized method to find new section element from HTML
   * @param {string} sectionId - The section ID
   * @param {string} html - The HTML content
   * @returns {Element|null} The new section element
   */
  #findNewSection(sectionId, html) {
    const newDOM = new DOMParser().parseFromString(html, 'text/html');
    return newDOM.querySelector(`[data-section-id="${sectionId}"] .section--main-cart`);
  }

  /**
   * Optimized method to update a single section
   * @param {string} sectionId - The section ID
   * @param {string} html - The HTML content
   */
  #updateSingleSection(sectionId, html) {
    const target = this.#findTargetSection(sectionId);
    const newSection = this.#findNewSection(sectionId, html);

    if (!target || !newSection) return;

    // Update children efficiently
    Array.from(newSection.children).forEach(child => {
      // Skip message and shipping blocks
      if (
        !child.classList.contains('cart-page__message') &&
        !child.classList.contains('cart-page__shipping')
      ) {
        let targetChild = null;
        // Prefer matching by id
        if (child.id) {
          targetChild = target.querySelector(`#${child.id}`);
        }
        // Fallback: match by first class name
        if (!targetChild && child.classList.length > 0) {
          targetChild = target.querySelector(`.${child.classList[0]}`);
        }
        // If a target child is found, replace it with the new child
        if (targetChild) {
          targetChild.replaceWith(child.cloneNode(true));
        }
      }
    });
  }

  /**
   * Override updateSections to handle drawer-specific updates
   * @param {Object} sections - The sections object from the response.
   */
  updateSections(sections) {
    if (!sections) return;

    resetSpinner(this);
    resetShimmer(this);

    // Handle cart-drawer section specially
    if (sections['cart-drawer']) {
      this.#updateCartDrawerFromHTML(sections['cart-drawer']);
      return;
    }

    // Process all sections efficiently
    Object.entries(sections).forEach(([id, html]) => {
      this.#updateSingleSection(id, html);
    });
  }

  /**
   * Update cart drawer from full HTML response
   * @param {string} html - The full cart drawer HTML
   */
  #updateCartDrawerFromHTML(html) {
    const newDOM = new DOMParser().parseFromString(html, 'text/html');
    const newCartDrawerItems = newDOM.querySelector('cart-drawer-items');
    const newCartDrawerFooter = newDOM.querySelector('.cart-drawer__footer');
    
    if (newCartDrawerItems) {
      const target = document.querySelector('cart-drawer-items');
      
      if (target) {
        const targetForm = target.querySelector('#CartDrawer-Form');
        const targetCartItems = target.querySelector('#CartDrawer-CartItems');
        const newForm = newCartDrawerItems.querySelector('#CartDrawer-Form');
        const newCartItems = newCartDrawerItems.querySelector('#CartDrawer-CartItems');
        
        if (targetForm && newForm) {
          targetForm.innerHTML = newForm.innerHTML;
        }
        if (targetCartItems && newCartItems) {
          targetCartItems.innerHTML = newCartItems.innerHTML;
        }
        
        // Update any other specific elements that need updating
        const targetLiveRegion = target.querySelector('#CartDrawer-LiveRegionText');
        const newLiveRegion = newCartDrawerItems.querySelector('#CartDrawer-LiveRegionText');
        if (targetLiveRegion && newLiveRegion) {
          targetLiveRegion.textContent = newLiveRegion.textContent;
        }
      }
    }
    
    // Update cart drawer footer
    if (newCartDrawerFooter) {
      const target = document.querySelector('.cart-drawer__footer');
      if (target) {
        target.innerHTML = newCartDrawerFooter.innerHTML;
      }
    }
  }

  /**
   * Override renderSection to handle drawer-specific section rendering
   * @param {string} sectionId
   * @param {string} html
   */
  renderSection(sectionId, html) {
    this.#updateSingleSection(sectionId, html);
  }
}
if (!customElements.get('cart-drawer-items')) customElements.define('cart-drawer-items', CartDrawerItems);

class QuantitySelectorComponent extends HTMLElement {
  constructor() {
    super();

    this.refs = {
      input: this.querySelector('.quantity__input'),
    };

    this.increase = this.increase.bind(this);
    this.decrease = this.decrease.bind(this);
    this.setQuantity = this.setQuantity.bind(this);
  }

  connectedCallback() {
    const input = this.refs.input;
    if (!input) return;

    this.addEventListener('increaseQuantity', this.increase);
    this.addEventListener('decreaseQuantity', this.decrease);
    input.addEventListener('blur', this.setQuantity);
    input.addEventListener('focus', () => input.select());
  }

  increase() {
    const input = this.refs.input;
    input.stepUp();
    this.dispatchQuantityUpdate();
  }

  decrease() {
    const input = this.refs.input;
    input.stepDown();
    this.dispatchQuantityUpdate();
  }

  selectInputValue() {
    const input = this.refs.input;
    input.select();
  }

  setQuantity() {
    this.dispatchQuantityUpdate();
  }

  dispatchQuantityUpdate() {
    const input = this.refs.input;
    const quantity = Number(input.value);
    const cartLine = Number(input.dataset.cartLine);

    this.#checkQuantityRules();

    const event = new CustomEvent('quantity-selector:update', {
      bubbles: true,
      detail: { quantity, cartLine },
    });

    this.dispatchEvent(event);
  }

  #checkQuantityRules() {
    const input = this.refs.input;
    const min = Number(input.min);
    const max = Number(input.max);
    const newValue = Number(input.value);

    if (!isNaN(min) && newValue < min) input.value = min;
    if (!isNaN(max) && max && newValue > max) input.value = max;
  }
}
if (!customElements.get('quantity-selector-component')) customElements.define('quantity-selector-component', QuantitySelectorComponent);

class CartDiscountComponent extends HTMLElement {
  constructor() {
    super();
    this.requiredRefs = ['cartDiscountError', 'cartDiscountErrorDiscountCode', 'cartDiscountErrorShipping'];
    /** @type {AbortController | null} */
    this.activeFetch = null;

    this.applyDiscount = this.applyDiscount.bind(this);
    this.removeDiscount = this.removeDiscount.bind(this);

    const discountForm = this.querySelector('form.cart-discount__form');
    if (discountForm) {
      discountForm.addEventListener('submit', this.applyDiscount);
    }

    this.addEventListener('click', (event) => {
      if (event.target.closest('.cart-discount__pill')) {
        this.removeDiscount(event);
      }
    });
    this.addEventListener('keydown', (event) => {
      if (
        event.target.closest('.cart-discount__pill') &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        this.removeDiscount(event);
      }
    });
  }

  get refs() {
    return {
      cartDiscountError: this.querySelector('.cart-discount__error'),
      cartDiscountErrorDiscountCode: this.querySelector('.cart-discount__error-discount-code'),
      cartDiscountErrorShipping: this.querySelector('.cart-discount__error-shipping')
    };
  }

  createAbortController() {
    if (this.activeFetch) {
      this.activeFetch.abort();
    }
    const abortController = new AbortController();
    this.activeFetch = abortController;
    return abortController;
  }

  existingDiscounts() {
    const discountCodes = [];
    const discountPills = this.querySelectorAll('.cart-discount__pill');
    for (const pill of discountPills) {
      if (pill instanceof HTMLLIElement && typeof pill.dataset.discountCode === 'string') {
        discountCodes.push(pill.dataset.discountCode);
      }
    }
    return discountCodes;
  }

  /**
   * Use CartItemsComponent.updateSections to update the relevant sections in the DOM.
   * @param {Object} sections - The sections object from the response.
   */
  updateSections(sections) {
    // Try to find cart items component in this order: drawer first, then main cart
    const cartItemsComponent = 
      document.querySelector('cart-drawer-items') || 
      document.querySelector('cart-items-component');
    
    if (cartItemsComponent && typeof cartItemsComponent.updateSections === 'function') {
      cartItemsComponent.updateSections(sections);
    } else {
      console.error('CartDiscountComponent: No cart items component found or updateSections method not available');
    }
  }

  renderSection(sectionId, html) {
    const cartItemsComponent = 
      document.querySelector('cart-drawer-items') || 
      document.querySelector('cart-items-component');
    
    if (cartItemsComponent && typeof cartItemsComponent.renderSection === 'function') {
      cartItemsComponent.renderSection(sectionId, html);
    } else {
      console.error('CartDiscountComponent: No cart items component found or renderSection method not available');
    }
  }

  async applyDiscount(event) {
    const { cartDiscountError, cartDiscountErrorDiscountCode, cartDiscountErrorShipping } = this.refs;

    event.preventDefault();
    event.stopPropagation();

    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const discountCodeInput = form.querySelector('input[name="discount"]');
    if (!(discountCodeInput instanceof HTMLInputElement) || typeof this.dataset.sectionId !== 'string') return;

    const discountCodeValue = discountCodeInput.value.trim();
    if (!discountCodeValue) return;

    const abortController = this.createAbortController();

    const spinner = this.querySelector('.loading__spinner');
    const submitDiscountButton = this.querySelector('.cart-discount__button');
    if (spinner && submitDiscountButton) {
      submitDiscountButton.setAttribute('aria-busy', 'true');
      submitDiscountButton.classList.add('loading');
      spinner.classList.remove('hidden');
    }

    try {
      const existingDiscounts = this.existingDiscounts();
      if (existingDiscounts.includes(discountCodeValue)) return;

      cartDiscountError.classList.add('hidden');
      cartDiscountErrorDiscountCode.classList.add('hidden');
      cartDiscountErrorShipping.classList.add('hidden');

      const bodyObj = {
        discount: [...existingDiscounts, discountCodeValue].join(','),
        sections: [this.dataset.sectionId],
      };

      const config = fetchConfig('json');

      const fetchOptions = {
        ...config,
        body: JSON.stringify(bodyObj),
        signal: abortController.signal,
      };

      const response = await fetch(`${routes.cart_update_url}`, fetchOptions);
      const data = await response.json();

      if (
        data.discount_codes &&
        data.discount_codes.find((discount) => {
          return discount.code === discountCodeValue && discount.applicable === false;
        })
      ) {
        discountCodeInput.value = '';
        this.handleDiscountError('discount_code');
        return;
      }

      const newHtml = data.sections && data.sections[this.dataset.sectionId];
      const parsedHtml = newHtml ? new DOMParser().parseFromString(newHtml, 'text/html') : null;
      const section = parsedHtml ? parsedHtml.getElementById(`shopify-section-${this.dataset.sectionId}`) : null;
      const discountPills = section?.querySelectorAll('.cart-discount__pill') || [];
      if (section) {
        const codes = Array.from(discountPills)
          .map((element) => (element instanceof HTMLLIElement ? element.dataset.discountCode : null))
          .filter(Boolean);
        if (
          codes.length === existingDiscounts.length &&
          codes.every((code) => existingDiscounts.includes(code)) &&
          data.discount_codes &&
          data.discount_codes.find((discount) => {
            return discount.code === discountCodeValue && discount.applicable === true;
          })
        ) {
          this.handleDiscountError('shipping');
          discountCodeInput.value = '';
          return;
        }
      }

      document.dispatchEvent(new CustomEvent('DiscountUpdateEvent', { detail: { data, id: this.id } }));

      if (data.sections) {
        this.updateSections(data.sections);
      } else if (newHtml) {
        this.renderSection(this.dataset.sectionId, newHtml);
      }
    } catch (error) {
    } finally {
      this.activeFetch = null;
      if (spinner && submitDiscountButton) {
        submitDiscountButton.removeAttribute('aria-busy');
        submitDiscountButton.classList.remove('loading');
        spinner.classList.add('hidden');
      }
      const cartPerf = /** @type {any} */ (window).cartPerformance || {};
      if (typeof cartPerf.measureFromEvent === 'function') {
        cartPerf.measureFromEvent('discount-update:user-action', event);
      }
    }
  }

  async removeDiscount(event) {
    event.preventDefault();
    event.stopPropagation();

    if (
      (event instanceof KeyboardEvent && event.key !== 'Enter') ||
      !(event instanceof MouseEvent) ||
      !(event.target instanceof HTMLElement) ||
      typeof this.dataset.sectionId !== 'string'
    ) {
      return;
    }

    const pill = event.target.closest('.cart-discount__pill');
    if (!(pill instanceof HTMLLIElement)) return;

    const discountCode = pill.dataset.discountCode;
    if (!discountCode) return;

    const existingDiscounts = this.existingDiscounts();
    const index = existingDiscounts.indexOf(discountCode);
    if (index === -1) return;

    existingDiscounts.splice(index, 1);

    const bodyObj = {
      discount: existingDiscounts.join(','),
      sections: [this.dataset.sectionId]
    };

    const abortController = this.createAbortController();

    try {
      const config = fetchConfig('json');

      const fetchOptions = {
        ...config,
        body: JSON.stringify(bodyObj),
        signal: abortController.signal,
      };

      const response = await fetch(`${routes.cart_update_url}`, fetchOptions);

      const data = await response.json();

      document.dispatchEvent(new CustomEvent('DiscountUpdateEvent', { detail: { data, id: this.id } }));

      if (data.sections) {
        this.updateSections(data.sections);
      } else if (data.sections && data.sections[this.dataset.sectionId]) {
        this.renderSection(this.dataset.sectionId, data.sections[this.dataset.sectionId]);
      }
    } catch (error) {
    } finally {
      this.activeFetch = null;
    }
  }

  handleDiscountError(type) {
    const { cartDiscountError, cartDiscountErrorDiscountCode, cartDiscountErrorShipping } = this.refs;
    const target =
      type === 'discount_code'
        ? cartDiscountErrorDiscountCode
        : cartDiscountErrorShipping;
    cartDiscountError && cartDiscountError.classList.remove('hidden');
    target && target.classList.remove('hidden');
  }
}
if (!customElements.get('cart-discount-component')) customElements.define('cart-discount-component', CartDiscountComponent);

if (!customElements.get('cart-note')) {
  customElements.define(
    'cart-note',
    class CartNote extends HTMLElement {
      constructor() {
        super();

        this.addEventListener(
          'input',
         theme.utils.debounce((event) => {
            const body = JSON.stringify({ note: event.target.value });
            fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } }).then(() => {
              const cartPerf = /** @type {any} */ (window).cartPerformance || {};
              if (typeof cartPerf.measureFromEvent === 'function') {
                cartPerf.measureFromEvent('note-update:user-action', event);
              }
            });
          }, ON_CHANGE_DEBOUNCE_TIMER)
        );
      }
    }
  );
}

class CountryProvinceComponent extends HTMLElement {
  constructor() {
    super();

    this.provinceElement = this.querySelector('[name="address[province]"]');
    this.countryElement = this.querySelector('[name="address[country]"]');
    this.countryElement.addEventListener('change', this.handleCountryChange.bind(this));

    if (this.dataset.country && this.dataset.country !== '') {
      const idx = Array.from(this.countryElement.options).findIndex(
        (option) => option.textContent === this.dataset.country
      );
      this.countryElement.selectedIndex = Math.max(0, idx);
      this.countryElement.dispatchEvent(new Event('change'));
    } else {
      this.handleCountryChange();
    }
  }

  handleCountryChange() {
    const option = this.countryElement.options[this.countryElement.selectedIndex];
    if (!option || !option.dataset.provinces) {
      this.provinceElement.parentElement.style.display = 'none';
      this.provinceElement.innerHTML = '';
      return;
    }
    let provinces = [];
    try {
      provinces = JSON.parse(option.dataset.provinces);
    } catch (e) {
      provinces = [];
    }
    this.provinceElement.parentElement.style.display = provinces.length === 0 ? 'none' : 'block';

    if (provinces.length === 0) {
      this.provinceElement.innerHTML = '';
      return;
    }

    this.provinceElement.innerHTML = '';

    provinces.forEach((data) => {
      const selected = data[1] === this.dataset.province;
      this.provinceElement.options.add(new Option(data[1], data[0], selected, selected));
    });
  }
}
if (!customElements.get('country-province-component')) customElements.define('country-province-component', CountryProvinceComponent);

class ShippingCalculatorComponent extends HTMLFormElement {
  constructor() {
    super();

    this.submitButton = this.querySelector('[type="submit"]');
    this.resultsElement = this.querySelector('.results');

    this.submitButton.addEventListener('click', this.handleFormSubmit.bind(this));
  }

  handleFormSubmit(event) {
    event.preventDefault();

    const zip = this.querySelector('[name="address[zip]"]').value,
      country = this.querySelector('[name="address[country]"]').value,
      province = this.querySelector('[name="address[province]"]').value;

    this.submitButton.setAttribute('aria-busy', 'true');

    const body = JSON.stringify({
      shipping_address: { zip, country, province }
    });
    let sectionUrl = `${routes.cart_url}/shipping_rates.json`;

    sectionUrl = sectionUrl.replace(/\/\//g, '/');

    fetch(sectionUrl, { ...fetchConfig('javascript'), ...{ body } })
      .then((response) => response.json())
      .then((parsedState) => {
        if (parsedState.shipping_rates) {
          this.formatShippingRates(parsedState.shipping_rates);
        } else {
          this.formatError(parsedState);
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        this.resultsElement.hidden = false;
        this.submitButton.removeAttribute('aria-busy');
      });
  }

  formatError(errors) {
    const shippingRatesList = Object.keys(errors).map((errorKey) => {
      return `<li>${errors[errorKey]}</li>`;
    });
    this.resultsElement.innerHTML = `
      <div class="alertBox alertBox--error grid gap-xl">
        <p>${window.shippingCalculatorStrings.error}</p>
        <ul class="list-disc grid gap-xl p-0 m-0" role="list">${shippingRatesList.join('')}</ul>
      </div>
    `;
  }

  formatShippingRates(shippingRates) {
    const shippingRatesList = shippingRates.map(({ presentment_name, currency, price }) => {
      return `<li>${presentment_name}: ${currency} ${price}</li>`;
    });
    this.resultsElement.innerHTML = `
      <div class="alertBox alertBox--${shippingRates.length === 0 ? 'error' : 'success'} grid gap-xl">
        <p>${shippingRates.length === 0 ? window.shippingCalculatorStrings.not_found : shippingRates.length === 1 ? window.shippingCalculatorStrings.one_result : window.shippingCalculatorStrings.multiple_results}</p>
        ${shippingRatesList.length === 0 ? '' : `<ul class="list-disc grid gap-xl p-0 m-0" role="list">${shippingRatesList.join('')}</ul>`}
      </div>
    `;
  }
}
if (!customElements.get('shipping-calculator-component')) customElements.define('shipping-calculator-component', ShippingCalculatorComponent, { extends: 'form' });
