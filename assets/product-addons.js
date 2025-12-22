class ProductAddons extends HTMLElement {
    constructor() {
        super();

        this.mainProductPrice = parseFloat(this.dataset.mainProductPrice || 0);
        this.checkboxes = this.querySelectorAll('[data-addon-checkbox]');
        this.productForm = document.querySelector('.product-form');
        this.addToCartButton = this.productForm?.querySelector('[data-btn-addToCart]');
        this.originalButtonText = this.addToCartButton?.textContent || '';

        // Initialize event listeners
        this.init();
    }

    init() {
        if (this.checkboxes.length === 0) return;

        // Add change event listeners to all checkboxes
        this.checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', this.handleCheckboxChange.bind(this));
        });

        // Listen for variant changes on main product
        if (this.productForm) {
            this.productForm.addEventListener('change', (event) => {
                if (event.target.name === 'id' || event.target.name === 'items[0][id]') {
                    // Clear all addon selections when variant changes
                    this.clearAddonSelections();
                    
                    // Wait a bit for the theme to update the button text first
                    setTimeout(() => {
                        // Capture the current button text (might be "Sold Out", "Add to Cart", etc.)
                        if (this.addToCartButton) {
                            this.originalButtonText = this.addToCartButton.textContent;
                        }
                        this.updateMainProductPrice(event.target);
                    }, 100);
                }
            });
        }

        // Update initial state
        this.updateTotalPrice();
    }

    handleCheckboxChange(event) {
        const checkbox = event.target;
        const addonItem = checkbox.closest('[data-addon-item]');

        if (checkbox.checked) {
            addonItem?.classList.add('is-selected');
        } else {
            addonItem?.classList.remove('is-selected');
        }

        this.updateTotalPrice();
    }

    updateMainProductPrice(inputElement) {
        // Get the variant ID from the input (could be select, radio, or hidden input)
        const variantId = inputElement.value;
        
        if (!variantId) return;

        // Try to get price from the input's data attribute first
        let variantPrice = inputElement.dataset?.price;

        // If it's a select element, get price from the selected option
        if (!variantPrice && inputElement.tagName === 'SELECT') {
            const selectedOption = inputElement.options[inputElement.selectedIndex];
            variantPrice = selectedOption?.dataset?.price;
        }

        // If still no price, try to find it from the product price display on the page
        if (!variantPrice) {
            const priceElement = document.querySelector('.price-item--regular .price') ||
                                document.querySelector('[data-product-price] .price') ||
                                document.querySelector('.product-price .price');
            
            if (priceElement) {
                const priceText = priceElement.textContent.trim();
                const priceMatch = priceText.match(/[\d,]+\.?\d*/);
                if (priceMatch) {
                    const numericPrice = parseFloat(priceMatch[0].replace(/,/g, ''));
                    // Convert to cents (Shopify uses cents)
                    variantPrice = (numericPrice * 100).toString();
                }
            }
        }

        if (variantPrice) {
            this.mainProductPrice = parseFloat(variantPrice);
            this.updateTotalPrice();
        }
    }

    clearAddonSelections() {
        // Uncheck all addon checkboxes
        this.checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                checkbox.checked = false;
                const addonItem = checkbox.closest('[data-addon-item]');
                addonItem?.classList.remove('is-selected');
            }
        });
        
        // Update the total price and form fields
        this.updateTotalPrice();
        
        // Trigger the updateFormFields function if it exists
        const updateEvent = new Event('change', { bubbles: true });
        this.checkboxes[0]?.dispatchEvent(updateEvent);
    }

    getSelectedAddons() {
        const selectedAddons = [];

        this.checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                const addonItem = checkbox.closest('[data-addon-item]');
                const addonPrice = parseFloat(addonItem?.dataset.addonPrice || 0);
                const addonId = addonItem?.dataset.addonId;

                if (addonId) {
                    selectedAddons.push({
                        id: addonId,
                        price: addonPrice
                    });
                }
            }
        });

        return selectedAddons;
    }

    calculateTotalPrice() {
        const selectedAddons = this.getSelectedAddons();
        let totalAddonsPrice = 0;

        selectedAddons.forEach(addon => {
            totalAddonsPrice += addon.price;
        });

        return this.mainProductPrice + totalAddonsPrice;
    }

    updateTotalPrice() {
        if (!this.addToCartButton) return;

        const selectedAddons = this.getSelectedAddons();
        const totalPrice = this.calculateTotalPrice();

        // Check if the button is disabled or shows sold out status
        const isButtonDisabled = this.addToCartButton.disabled || 
                                 this.addToCartButton.classList.contains('disabled') ||
                                 this.addToCartButton.hasAttribute('disabled');
        
        const buttonText = this.addToCartButton.textContent.toLowerCase();
        const isSoldOut = buttonText.includes('sold out') || 
                         buttonText.includes('unavailable') || 
                         buttonText.includes('out of stock');



        // Don't update button text if variant is unavailable/sold out
        if (!isButtonDisabled && !isSoldOut) {
            // Update button text with total price if addons are selected
            if (selectedAddons.length > 0) {
                const formattedPrice = Shopify.formatMoney(totalPrice, window.money_format);
                const buttonTextToUse = this.originalButtonText.includes('$')
                    ? this.originalButtonText.replace(/\$[\d,\.]+/, formattedPrice)
                    : `${this.originalButtonText} - ${formattedPrice}`;

                this.addToCartButton.textContent = buttonTextToUse;
                this.addToCartButton.dataset.totalPrice = totalPrice;
                this.addToCartButton.dataset.hasAddons = 'true';
            } else {
                // Reset to original text if no addons selected
                this.addToCartButton.textContent = this.originalButtonText;
                this.addToCartButton.dataset.totalPrice = this.mainProductPrice;
                delete this.addToCartButton.dataset.hasAddons;
            }
        }

        // Trigger custom event for other scripts that might need to know about price changes
        document.dispatchEvent(new CustomEvent('addon-price-updated', {
            detail: {
                mainProductPrice: this.mainProductPrice,
                addonsPrice: totalPrice - this.mainProductPrice,
                totalPrice: totalPrice,
                selectedAddons: selectedAddons
            }
        }));
    }

    // Method to get selected addon IDs for adding to cart
    getSelectedAddonIds() {
        return this.getSelectedAddons().map(addon => addon.id);
    }
}

// Register the custom element
customElements.define('product-addons', ProductAddons);

// Enhance the main add to cart functionality to include addons
document.addEventListener('DOMContentLoaded', function() {
    const productForm = document.querySelector('form[data-type="add-to-cart-form"]');
    const addonsElement = document.querySelector('product-addons');

    if (!productForm || !addonsElement) {
        console.log('Product form or addons element not found');
        return;
    }

    console.log('Initializing addon form integration');

    // Function to update form fields based on selected addons
    function updateFormFields() {
        console.log('Updating form fields...');

        // Remove any previously added addon fields
        const existingAddonFields = productForm.querySelectorAll('[data-addon-field]');
        existingAddonFields.forEach(field => field.remove());

        const mainVariantId = productForm.querySelector('[name="id"]')?.value ||
            productForm.querySelector('[name="items[0][id]"]')?.value;
        const selectedAddons = addonsElement.getSelectedAddons();

        // Get main product name from the page
        const mainProductName = document.querySelector('.productView-title')?.textContent?.trim() ||
            document.querySelector('h1')?.textContent?.trim() ||
            document.querySelector('[data-product-title]')?.textContent?.trim() ||
            'Main Product';

        /*console.log('Main variant ID:', mainVariantId);
        console.log('Main product name:', mainProductName);
        console.log('Selected addons:', selectedAddons.length);*/

        if (!mainVariantId) {
            console.error('No variant ID found');
            return;
        }

        // If addons are selected, convert to items[] format
        if (selectedAddons.length > 0) {
            // console.log('Converting form to items[] format');

            // Convert original fields to items[0] format
            const originalIdField = productForm.querySelector('[name="id"]');
            const originalQuantityField = productForm.querySelector('[name="quantity"]');

            if (originalIdField && !originalIdField.hasAttribute('data-addon-modified')) {
                originalIdField.setAttribute('name', 'items[0][id]');
                originalIdField.setAttribute('data-addon-modified', 'true');
                // console.log('Converted main product ID field');
            }
            if (originalQuantityField && !originalQuantityField.hasAttribute('data-addon-modified')) {
                originalQuantityField.setAttribute('name', 'items[0][quantity]');
                originalQuantityField.setAttribute('data-addon-modified', 'true');
                // console.log('Converted main product quantity field');
            }
            
            // Generate a unique group ID for this addon bundle
            const addonGroupId = `addon_bundle_${Date.now()}_${mainVariantId}`;

            // Add hidden fields for each addon product
            selectedAddons.forEach((addon, index) => {
                const itemIndex = index + 1; // Start from 1 since 0 is the main product

                // Get addon product name from the DOM
                const addonItem = document.querySelector(`[data-addon-item][data-addon-id="${addon.id}"]`);
                const addonProductName = addonItem?.querySelector('.addon-item-title')?.textContent?.trim() || 'Addon Product';

                // Create hidden input for addon variant ID
                const addonIdField = document.createElement('input');
                addonIdField.type = 'hidden';
                addonIdField.name = `items[${itemIndex}][id]`;
                addonIdField.value = addon.id;
                addonIdField.setAttribute('data-addon-field', 'true');
                productForm.appendChild(addonIdField);

                // Create hidden input for addon quantity
                const addonQtyField = document.createElement('input');
                addonQtyField.type = 'hidden';
                addonQtyField.name = `items[${itemIndex}][quantity]`;
                addonQtyField.value = '1';
                addonQtyField.setAttribute('data-addon-field', 'true');
                productForm.appendChild(addonQtyField);

                // Add VISIBLE property for checkout (shows "Addon - Parent Product Name")
                const visiblePropertyField = document.createElement('input');
                visiblePropertyField.type = 'hidden';
                visiblePropertyField.name = `items[${itemIndex}][properties][Addon for]`;
                visiblePropertyField.value = mainProductName;
                visiblePropertyField.setAttribute('data-addon-field', 'true');
                productForm.appendChild(visiblePropertyField);

                // Add property to identify it as an addon (hidden, for internal use)
                const addonPropertyField = document.createElement('input');
                addonPropertyField.type = 'hidden';
                addonPropertyField.name = `items[${itemIndex}][properties][_addon_for]`;
                addonPropertyField.value = mainVariantId;
                addonPropertyField.setAttribute('data-addon-field', 'true');
                productForm.appendChild(addonPropertyField);

                // Add property to mark this as an addon product (hidden)
                const addonTypeField = document.createElement('input');
                addonTypeField.type = 'hidden';
                addonTypeField.name = `items[${itemIndex}][properties][_is_addon]`;
                addonTypeField.value = 'true';
                addonTypeField.setAttribute('data-addon-field', 'true');
                productForm.appendChild(addonTypeField);

                // Add property with unique group ID for cart transform (hidden)
                // const addonGroupField = document.createElement('input');
                // addonGroupField.type = 'hidden';
                // addonGroupField.name = `items[${itemIndex}][properties][_addon_group_id]`;
                // addonGroupField.value = addonGroupId;
                // addonGroupField.setAttribute('data-addon-field', 'true');
                // productForm.appendChild(addonGroupField);

                // Add property with addon index in the bundle (hidden)
                const addonIndexField = document.createElement('input');
                addonIndexField.type = 'hidden';
                addonIndexField.name = `items[${itemIndex}][properties][_addon_index]`;
                addonIndexField.value = index.toString();
                addonIndexField.setAttribute('data-addon-field', 'true');
                productForm.appendChild(addonIndexField);

                console.log(`Added addon field ${itemIndex}: ${addonProductName} for ${mainProductName}, Group: ${addonGroupId}`);
            });
        } else {
            // No addons selected, restore original field names
            //console.log('No addons selected, restoring original format');

            const idField = productForm.querySelector('[name="items[0][id]"]');
            const qtyField = productForm.querySelector('[name="items[0][quantity]"]');

            if (idField && idField.hasAttribute('data-addon-modified')) {
                idField.setAttribute('name', 'id');
                idField.removeAttribute('data-addon-modified');
                //console.log('Restored main product ID field');
            }
            if (qtyField && qtyField.hasAttribute('data-addon-modified')) {
                qtyField.setAttribute('name', 'quantity');
                qtyField.removeAttribute('data-addon-modified');
                //console.log('Restored main product quantity field');
            }
        }

        //console.log('Form fields updated');
    }

    // Listen for addon checkbox changes
    const addonCheckboxes = addonsElement.querySelectorAll('[data-addon-checkbox]');
    addonCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            //console.log('Addon checkbox changed:', checkbox.value, checkbox.checked);
            updateFormFields();
        });
    });

    // Initial update
    updateFormFields();
});

