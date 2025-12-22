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
                if (event.target.name === 'id') {
                    this.updateMainProductPrice(event.target);
                    this.checkMainProductAvailability(event.target);
                }
            });
        }

        // Subscribe to pubsub variant change event (theme's native event system)
        if (typeof subscribe !== 'undefined' && typeof PUB_SUB_EVENTS !== 'undefined') {
            this.unsubscribeVariantChange = subscribe(PUB_SUB_EVENTS.variantChange, (event) => {
                console.log("variant change event", event);
                if (event.data && event.data.variant) {
                    console.log("variant change", event.data);
                    this.handleVariantChange(event.data.variant);
                }
            });
        }

        // Watch for add to cart button state changes as a fallback
        if (this.addToCartButton) {
            const buttonObserver = new MutationObserver(() => {
                this.checkAddToCartButtonState();
            });
            
            buttonObserver.observe(this.addToCartButton, {
                attributes: true,
                attributeFilter: ['disabled', 'class']
            });
        }

        // Update initial state
        this.updateTotalPrice();
        this.checkInitialAvailability();
    }

    disconnectedCallback() {
        // Cleanup subscription when element is removed
        if (this.unsubscribeVariantChange) {
            this.unsubscribeVariantChange();
        }
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

    updateMainProductPrice(inputOrSelectElement) {
        let variantPrice;
        
        // Handle both SELECT and INPUT elements
        if (inputOrSelectElement.tagName === 'SELECT') {
            const selectedOption = inputOrSelectElement.options[inputOrSelectElement.selectedIndex];
            variantPrice = selectedOption?.dataset.price;
        } else if (inputOrSelectElement.tagName === 'INPUT') {
            // For hidden inputs, try to get price from data attribute or variant data
            variantPrice = inputOrSelectElement.dataset.price;
            
            // If no price on input, try to get from variant data
            if (!variantPrice) {
                const variantId = inputOrSelectElement.value;
                const variantData = this.getVariantData(variantId);
                if (variantData) {
                    variantPrice = variantData.price;
                }
            }
        }
        
        if (variantPrice) {
            this.mainProductPrice = parseFloat(variantPrice);
            this.updateTotalPrice();
        }
    }

    checkInitialAvailability() {
        // Check availability of the initially selected variant
        const variantInput = this.productForm?.querySelector('[name="id"]');
        if (variantInput) {
            this.checkMainProductAvailability(variantInput);
        }
    }

    checkMainProductAvailability(inputOrSelectElement) {
        let variantId;
        let isAvailable = true;
        let inventoryQuantity = 0;
        
        // Handle both select elements and hidden inputs
        if (inputOrSelectElement.tagName === 'SELECT') {
            const selectedOption = inputOrSelectElement.options[inputOrSelectElement.selectedIndex];
            variantId = selectedOption?.value;
            isAvailable = selectedOption?.dataset.available === 'true';
            inventoryQuantity = parseInt(selectedOption?.dataset.inventoryQuantity || '0');
        } else {
            // For hidden inputs, get the variant ID directly
            variantId = inputOrSelectElement.value;
        }
        
        // If we have a variant ID but couldn't get availability from data attributes,
        // try to get it from the global product data
        if (variantId && isAvailable === true) {
            const variantData = this.getVariantData(variantId);
            if (variantData) {
                isAvailable = variantData.available;
                inventoryQuantity = variantData.inventory_quantity || 0;
            }
        }
        
        // Check if variant is sold out or doesn't have enough quantity
        const isSoldOut = !isAvailable;
        
        this.toggleAddonsAvailability(!isSoldOut);
    }

    getVariantData(variantId) {
        // Try to find variant data from Shopify's product JSON
        try {
            // Look for product data in the window object
            const productData = window.ShopifyAnalytics?.meta?.product;
            if (productData && productData.variants) {
                const variant = productData.variants.find(v => v.id == variantId);
                if (variant) return variant;
            }
            
            // Try alternate data source - check for variant data in data attributes
            const productElement = document.querySelector('[data-product-json]');
            if (productElement) {
                const product = JSON.parse(productElement.dataset.productJson);
                const variant = product.variants.find(v => v.id == variantId);
                if (variant) return variant;
            }
            
            // Check the add to cart button state
            const addToCartBtn = this.productForm?.querySelector('[data-btn-addToCart]');
            if (addToCartBtn) {
                const isDisabled = addToCartBtn.disabled || 
                                 addToCartBtn.classList.contains('disabled') ||
                                 addToCartBtn.classList.contains('sold-out');
                
                return {
                    available: !isDisabled,
                    inventory_quantity: isDisabled ? 0 : 1
                };
            }
        } catch (error) {
            console.log('Could not parse variant data:', error);
        }
        
        return null;
    }

    handleVariantChange(variant) {
        // Handle variant changes from custom events
        const isAvailable = variant.available;
        const inventoryQuantity = variant.inventory_quantity || 0;
        const inventoryManagement = variant.inventory_management;
        
        const isSoldOut = !isAvailable || 
                         (inventoryManagement && inventoryQuantity <= 0);
        
        this.toggleAddonsAvailability(!isSoldOut);
    }

    checkAddToCartButtonState() {
        // Check if the add to cart button is disabled or has sold-out class
        if (!this.addToCartButton) return;
        
        const isDisabled = this.addToCartButton.disabled || 
                          this.addToCartButton.classList.contains('disabled') ||
                          this.addToCartButton.classList.contains('sold-out') ||
                          this.addToCartButton.classList.contains('is-disable');
        
        this.toggleAddonsAvailability(!isDisabled);
    }

    toggleAddonsAvailability(enable) {
        const addonsContainer = this.querySelector('.product-addons-list') || this;
        
        this.checkboxes.forEach(checkbox => {
            const addonItem = checkbox.closest('[data-addon-item]');
            
            if (enable) {
                // Enable addons
                checkbox.disabled = false;
                checkbox.removeAttribute('disabled');
                addonItem?.classList.remove('is-disabled');
            } else {
                // Disable addons and uncheck them
                checkbox.disabled = true;
                checkbox.setAttribute('disabled', 'disabled');
                checkbox.checked = false;
                addonItem?.classList.remove('is-selected');
                addonItem?.classList.add('is-disabled');
            }
        });
        
        // Update the container state
        if (enable) {
            addonsContainer.classList.remove('addons-disabled');
        } else {
            addonsContainer.classList.add('addons-disabled');
        }
        
        // Update the total price after disabling
        if (!enable) {
            this.updateTotalPrice();
        }
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
        
        // Update button text with total price if addons are selected
        if (selectedAddons.length > 0) {
            const formattedPrice = Shopify.formatMoney(totalPrice, window.money_format);
            const buttonText = this.originalButtonText.includes('$') 
                ? this.originalButtonText.replace(/\$[\d,\.]+/, formattedPrice)
                : `${this.originalButtonText} - ${formattedPrice}`;
            
            this.addToCartButton.textContent = buttonText;
            this.addToCartButton.dataset.totalPrice = totalPrice;
            this.addToCartButton.dataset.hasAddons = 'true';
        } else {
            // Reset to original text if no addons selected
            this.addToCartButton.textContent = this.originalButtonText;
            this.addToCartButton.dataset.totalPrice = this.mainProductPrice;
            delete this.addToCartButton.dataset.hasAddons;
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
        
        console.log('Main variant ID:', mainVariantId);
        console.log('Main product name:', mainProductName);
        console.log('Selected addons:', selectedAddons.length);
        
        if (!mainVariantId) {
            console.error('No variant ID found');
            return;
        }
        
        // If addons are selected, convert to items[] format
        if (selectedAddons.length > 0) {
            console.log('Converting form to items[] format');
            
            // Convert original fields to items[0] format
            const originalIdField = productForm.querySelector('[name="id"]');
            const originalQuantityField = productForm.querySelector('[name="quantity"]');
            
            if (originalIdField && !originalIdField.hasAttribute('data-addon-modified')) {
                originalIdField.setAttribute('name', 'items[0][id]');
                originalIdField.setAttribute('data-addon-modified', 'true');
                console.log('Converted main product ID field');
            }
            if (originalQuantityField && !originalQuantityField.hasAttribute('data-addon-modified')) {
                originalQuantityField.setAttribute('name', 'items[0][quantity]');
                originalQuantityField.setAttribute('data-addon-modified', 'true');
                console.log('Converted main product quantity field');
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
                const addonGroupField = document.createElement('input');
                addonGroupField.type = 'hidden';
                addonGroupField.name = `items[${itemIndex}][properties][_addon_group_id]`;
                addonGroupField.value = addonGroupId;
                addonGroupField.setAttribute('data-addon-field', 'true');
                productForm.appendChild(addonGroupField);
                
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
            console.log('No addons selected, restoring original format');
            
            const idField = productForm.querySelector('[name="items[0][id]"]');
            const qtyField = productForm.querySelector('[name="items[0][quantity]"]');
            
            if (idField && idField.hasAttribute('data-addon-modified')) {
                idField.setAttribute('name', 'id');
                idField.removeAttribute('data-addon-modified');
                console.log('Restored main product ID field');
            }
            if (qtyField && qtyField.hasAttribute('data-addon-modified')) {
                qtyField.setAttribute('name', 'quantity');
                qtyField.removeAttribute('data-addon-modified');
                console.log('Restored main product quantity field');
            }
        }
        
        console.log('Form fields updated');
    }
    
    // Listen for addon checkbox changes
    const addonCheckboxes = addonsElement.querySelectorAll('[data-addon-checkbox]');
    addonCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            console.log('Addon checkbox changed:', checkbox.value, checkbox.checked);
            updateFormFields();
        });
    });
    
    // Initial update
    updateFormFields();
});


