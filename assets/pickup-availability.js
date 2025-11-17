if (!customElements.get('pickup-availability')) {
  class PickupAvailability extends HTMLElement {
    constructor() {
      super();

      if (!this.hasAttribute('available')) return;

      this.errorHtml = this.querySelector('template').content.firstElementChild.cloneNode(true);
      this.onClickRefreshList = this.onClickRefreshList.bind(this);
      this.fetchAvailability(this.dataset.variantId);
    }

    fetchAvailability(variantId) {
      if (!variantId) return;

      let rootUrl = this.dataset.rootUrl;
      if (!rootUrl.endsWith('/')) {
        rootUrl = rootUrl + '/';
      }
      const variantSectionUrl = `${rootUrl}variants/${variantId}/?section_id=pickup-availability`;

      fetch(variantSectionUrl)
        .then((response) => response.text())
        .then((text) => {
          const sectionInnerHTML = new DOMParser()
            .parseFromString(text, 'text/html')
            .querySelector('.shopify-section');
          this.renderPreview(sectionInnerHTML);
        })
        .catch((e) => {
          const button = this.querySelector('button');
          if (button) button.removeEventListener('click', this.onClickRefreshList);
          this.renderError();
        });
    }

    onClickRefreshList() {
      this.fetchAvailability(this.dataset.variantId);
    }

    update(variant) {
      if (variant?.available) {
        this.fetchAvailability(variant.id);
      } else {
        this.removeAttribute('available');
        this.innerHTML = '';
      }
    }

    renderError() {
      this.innerHTML = '';
      this.appendChild(this.errorHtml);

      this.querySelector('button').addEventListener('click', this.onClickRefreshList);
    }

    renderPreview(sectionInnerHTML) {
      const drawer = document.querySelector('pickup-availability-drawer');
      if (drawer) drawer.remove();
      if (!sectionInnerHTML.querySelector('pickup-availability-preview')) {
        this.innerHTML = '';
        this.removeAttribute('available');
        return;
      }

      this.innerHTML = sectionInnerHTML.querySelector('pickup-availability-preview').outerHTML;
      this.setAttribute('available', '');

      document.body.appendChild(sectionInnerHTML.querySelector('pickup-availability-drawer'));
      const colorClassesToApply = this.dataset.productPageColorScheme.split(' ');
      colorClassesToApply.forEach((colorClass) => {
        document.querySelector('.pickup-availability-drawer .drawer__inner').classList.add(colorClass);
      });

      const button = this.querySelector('button');
      if (button)
        button.addEventListener('click', (evt) => {
          document.querySelector('pickup-availability-drawer').open(evt.target);
        });
    }
  }

  customElements.define('pickup-availability', PickupAvailability);
}

if (!customElements.get('pickup-availability-drawer')) {
  class PickupAvailabilityDrawer extends HTMLElement {
    constructor() {
      super();
      this.addEventListener('keyup', (event) => event.code === 'Escape' && this.close());
      this.overlay = this.querySelector('#PickupAvailabilityDrawer-Overlay');
      this.overlay?.addEventListener('click', this.close.bind(this));
      this.setHeaderAccessibility();
    }

    setHeaderAccessibility() {
      const button = document.querySelector('#ShowPickupAvailabilityDrawer');
      button.setAttribute('role', 'button');
      button.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
          event.preventDefault();
          this.open(button);
        }
      });
    }

    async close() {
      this.classList.remove('active');
      this.removeAttribute('open');
      removeTrapFocus(this.focusElement);
      document.body.classList.remove('overflow-hidden');
      document.documentElement.removeAttribute('scroll-lock');
      
      const dir = this.getAttribute("data-drawer-direction") || "right";
      const contentElement = this.querySelector(".drawer__inner");

      await Motion.timeline([
        [
          contentElement,
          {
            opacity: [1, 0],
            transform: dir === "left" ? ["translateX(0)", "translateX(-100%)"] : ["translateX(0)", "translateX(100%)"]
          },
          { duration: 0.3, easing: [0.61, 0.22, 0.23, 1] }
        ],
        [
          this.overlay,
          {
            transform: dir === "left" ? ["translateX(0)", "translateX(-100%)"] : ["translateX(0)", "translateX(100%)"]
          },
          { duration: 0.3, easing: [0.61, 0.22, 0.23, 1], at: "+0.1" }
        ]
      ]).finished;
    }

    open(focusElement) {
      this.focusElement = focusElement;
      const dir = this.getAttribute("data-drawer-direction") || "right";
      const contentElement = this.querySelector(".drawer__inner");

      this.setAttribute('open', '');
      this.classList.add('active');
      document.body.classList.add('overflow-hidden');
      document.documentElement.setAttribute('scroll-lock', '');

      setTimeout(() => {
        this.classList.add('animate');
      });

      Motion.timeline([
        [
          this.overlay,
          {
            transform: dir === "left" ? ["translateX(-100%)", "translateX(0)"] : ["translateX(100%)", "translateX(0)"]
          },
          { duration: 0.3, easing: [0.61, 0.22, 0.23, 1] }
        ],
        [
          contentElement,
          {
            opacity: [0, 1],
            transform: dir === "left" ? ["translateX(-100%)", "translateX(0)"] : ["translateX(100%)", "translateX(0)"]
          },
          { duration: 0.3, easing: [0.61, 0.22, 0.23, 1], at: "-0.05" }
        ]
      ]);

      this.addEventListener('transitionend', () => {
        const containerToTrapFocusOn = document.getElementById('PickupAvailabilityDrawer');
        const focusEl = this.querySelector('.drawer__inner') || this.querySelector('.drawer__close');
        trapFocus(containerToTrapFocusOn, focusEl);
      }, { once: true });
    }
  }

  customElements.define('pickup-availability-drawer', PickupAvailabilityDrawer);
}