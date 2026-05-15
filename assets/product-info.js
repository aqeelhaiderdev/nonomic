if (!customElements.get('product-info')) {
  customElements.define(
    'product-info',
    class ProductInfo extends HTMLElement {
      quantityInput = undefined;
      quantityForm = undefined;
      onVariantChangeUnsubscriber = undefined;
      cartUpdateUnsubscriber = undefined;
      abortController = undefined;
      pendingRequestUrl = null;
      preProcessHtmlCallbacks = [];
      postProcessHtmlCallbacks = [];

      constructor() {
        super();

        this.quantityInput = this.querySelector('.quantity__input');
      }

      connectedCallback() {
        this.initializeProductSwapUtility();

        this.onVariantChangeUnsubscriber = subscribe(
          PUB_SUB_EVENTS.optionValueSelectionChange,
          this.handleOptionValueChange.bind(this)
        );

        this.initQuantityHandlers();
        this.initSubmitPriceSubscriptionSync();
        this.dispatchEvent(new CustomEvent('product-info:loaded', { bubbles: true }));
      }

      addPreProcessCallback(callback) {
        this.preProcessHtmlCallbacks.push(callback);
      }

      initQuantityHandlers() {
        if (!this.quantityInput) return;

        this.quantityForm = this.querySelector('.product-form__quantity');
        if (!this.quantityForm) return;

        this.setQuantityBoundries();
        if (!this.dataset.originalSection) {
          this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, this.fetchQuantityRules.bind(this));
        }
      }

      disconnectedCallback() {
        this.onVariantChangeUnsubscriber();
        this.cartUpdateUnsubscriber?.();
        this.destroySubmitPriceSubscriptionSync();
      }

      initializeProductSwapUtility() {
        this.preProcessHtmlCallbacks.push((html) =>
          html.querySelectorAll('.scroll-trigger').forEach((element) => element.classList.add('scroll-trigger--cancel'))
        );
        this.postProcessHtmlCallbacks.push((newNode) => {
          window?.Shopify?.PaymentButton?.init();
          window?.ProductModel?.loadShopifyXR();
        });
      }

      handleOptionValueChange({ data: { event, target, selectedOptionValues } }) {
        if (!this.contains(event.target)) return;

        this.resetProductFormState();

        const productUrl = target.dataset.productUrl || this.pendingRequestUrl || this.dataset.url;
        this.pendingRequestUrl = productUrl;
        const shouldSwapProduct = this.dataset.url !== productUrl;
        const shouldFetchFullPage = this.dataset.updateUrl === 'true' && shouldSwapProduct;

        this.renderProductInfo({
          requestUrl: this.buildRequestUrlWithParams(productUrl, selectedOptionValues, shouldFetchFullPage),
          targetId: target.id,
          callback: shouldSwapProduct
            ? this.handleSwapProduct(productUrl, shouldFetchFullPage)
            : this.handleUpdateProductInfo(productUrl),
        });
      }

      resetProductFormState() {
        const productForm = this.productForm;
        productForm?.toggleSubmitButton(true);
        productForm?.handleErrorMessage();
      }

      initSubmitPriceSubscriptionSync() {
        this.boundScheduleSubmitPriceUpdate = () => {
          clearTimeout(this.submitPriceUpdateTimer);
          this.submitPriceUpdateTimer = setTimeout(() => this.updateSubmitButtonPrice(), 60);
        };

        this.addEventListener('change', this.boundScheduleSubmitPriceUpdate);
        this.addEventListener('input', this.boundScheduleSubmitPriceUpdate);
        this.addEventListener('click', this.boundScheduleSubmitPriceUpdate, true);

        requestAnimationFrame(() => {
          this.attachSubscriptionDomObservers();
          [200, 600, 2000, 4000].forEach((ms) => setTimeout(() => this.attachSubscriptionDomObservers(), ms));
        });
      }

      getProductAtcForm() {
        return this.querySelector('form[data-type="add-to-cart-form"]');
      }

      /**
       * Appstle / other apps may inject late, use sibling section, or only touch the form subtree.
       * Observers are skipped once attached (except product-info / form observers stay on this).
       */
      attachSubscriptionDomObservers() {
        if (typeof MutationObserver === 'undefined') return;

        const widget = this.findSubscriptionWidgetRoot();
        if (widget && !this.subscriptionWidgetObserver) {
          this.subscriptionWidgetObserver = new MutationObserver(this.boundScheduleSubmitPriceUpdate);
          this.subscriptionWidgetObserver.observe(widget, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-checked', 'aria-selected', 'data-selected', 'value', 'checked'],
          });
        }

        const addForm = this.getProductAtcForm();
        const hiddenPlan = addForm?.querySelector(
          'input[name="selling_plan"][type="hidden"], input[name="selling_plan"][type="text"]'
        );
        if (hiddenPlan && !this.sellingPlanHiddenObserver) {
          this.sellingPlanHiddenObserver = new MutationObserver(this.boundScheduleSubmitPriceUpdate);
          this.sellingPlanHiddenObserver.observe(hiddenPlan, { attributes: true, attributeFilter: ['value'] });
        }

        if (addForm && !this.formMutationObserver) {
          this.formMutationObserver = new MutationObserver(this.boundScheduleSubmitPriceUpdate);
          this.formMutationObserver.observe(addForm, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['value', 'class', 'aria-checked', 'checked'],
          });
        }

        if (!this.productInfoMutationObserver) {
          this.productInfoMutationObserver = new MutationObserver(this.boundScheduleSubmitPriceUpdate);
          this.productInfoMutationObserver.observe(this, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'aria-checked', 'aria-selected', 'value', 'data-selected'],
          });
        }
      }

      destroySubmitPriceSubscriptionSync() {
        if (this.boundScheduleSubmitPriceUpdate) {
          this.removeEventListener('change', this.boundScheduleSubmitPriceUpdate);
          this.removeEventListener('input', this.boundScheduleSubmitPriceUpdate);
          this.removeEventListener('click', this.boundScheduleSubmitPriceUpdate, true);
        }
        clearTimeout(this.submitPriceUpdateTimer);
        this.subscriptionWidgetObserver?.disconnect();
        this.subscriptionWidgetObserver = undefined;
        this.sellingPlanHiddenObserver?.disconnect();
        this.sellingPlanHiddenObserver = undefined;
        this.formMutationObserver?.disconnect();
        this.formMutationObserver = undefined;
        this.productInfoMutationObserver?.disconnect();
        this.productInfoMutationObserver = undefined;
      }

      findSubscriptionWidgetRoot() {
        const sel =
          '[id^="appstle_selling_plan" i],[id*="appstle" i],[class*="appstle" i],[class*="Appstle"],[data-appstle],[data-appstle-subscription],[class*="subscription-widget"],[data-subscription-widget],[class*="selling-plan"],[id*="selling_plan"],[class*="skio" i],[class*="seal" i],[data-recharge]';

        const pickFrom = (root) => {
          if (!root) return null;
          const all = [...root.querySelectorAll(sel)];
          if (!all.length) return null;
          const byId = all.find((n) => /appstle|selling|subscription|skio|seal|recharge/i.test(n.id || ''));
          if (byId) return byId;
          return all.reduce((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return ra.width * ra.height >= rb.width * rb.height ? a : b;
          });
        };

        let node = pickFrom(this);
        if (node) return node;

        const section = this.closest('.shopify-section') || this.closest('section[id^="shopify-section"]');
        if (section && section !== this) {
          node = pickFrom(section);
          if (node && section.contains(this)) return node;
        }
        return null;
      }

      isOneTimePurchaseText(text) {
        const t = (text || '').toLowerCase();
        return (
          t.includes('one-time') ||
          t.includes('one time') ||
          t.includes('onetime') ||
          t.includes('purchase once') ||
          t.includes('one-off') ||
          t.includes('pay once') ||
          t.includes('buy once') ||
          t.includes('single purchase')
        );
      }

      /**
       * Lowest money-like amount in scope (excludes <s> strike-through), so subscription rows
       * prefer the discounted price over compare-at when both appear in the same block.
       */
      extractLowestMoneyInScope(root, opts = {}) {
        if (!root) return null;
        const { excludeClosest } = opts;
        const excludeList = excludeClosest
          ? Array.isArray(excludeClosest)
            ? excludeClosest
            : String(excludeClosest)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
          : [];
        const moneyRe = /[\$€£][\d,]+(?:\.\d{2})?/g;
        const amounts = [];
        const tags =
          'span,div,p,strong,b,em,small,i,label,td,th,h1,h2,h3,h4,h5,h6,button,li,dd,dt,cite,font,aside,article';
        root.querySelectorAll(tags).forEach((el) => {
          if (el.closest('s')) return;
          for (const ex of excludeList) {
            if (ex && el.closest(ex)) return;
          }
          const txt = el.textContent.trim().replace(/\s+/g, ' ');
          if (!txt || txt.length > 140) return;
          for (const m of txt.matchAll(moneyRe)) {
            const num = parseFloat(m[0].replace(/[$,€£]/g, ''));
            if (!Number.isNaN(num)) amounts.push({ num, text: m[0] });
          }
        });
        if (!amounts.length) return null;
        amounts.sort((a, b) => a.num - b.num);
        return amounts[0].text;
      }

      /**
       * Finds the DOM node for the *purchase type* option the shopper selected (one-time vs subscribe).
       * Appstle may use role="radio", native radios, or aria-pressed buttons — frequency rows are ignored.
       */
      getSelectedPurchaseOptionRow(widget, form) {
        if (!widget) return null;

        const isFrequencyRow = (el) => {
          const t = (el.textContent || '').toLowerCase();
          return (
            (t.includes('every ') ||
              t.includes('ship every') ||
              t.includes('delivery frequency') ||
              (t.includes('frequency') && t.includes('day'))) &&
            !t.includes('subscribe') &&
            !this.isOneTimePurchaseText(t)
          );
        };

        const looksLikePurchaseOption = (el) => {
          const t = (el.textContent || '').toLowerCase();
          if (this.isOneTimePurchaseText(t)) return true;
          if (t.includes('subscribe')) return true;
          if (t.includes('recurring')) return true;
          if (t.includes('save') && t.includes('%')) return true;
          if (/\$\s*[\d,]+/.test(el.textContent || '')) return true;
          return false;
        };

        const hidden = form?.querySelector(
          'input[name="selling_plan"][type="hidden"], input[type="hidden"][name*="selling_plan" i], input[type="hidden"][name*="appstle" i]'
        );
        const hasPlan = !!(hidden?.value && String(hidden.value).trim());

        const roleChecked = [
          ...widget.querySelectorAll('[role="radio"][aria-checked="true"], [role="radio"][aria-selected="true"]'),
        ]
          .filter((el) => !isFrequencyRow(el))
          .filter(looksLikePurchaseOption);

        if (roleChecked.length === 1) return roleChecked[0];
        if (roleChecked.length > 1) {
          const sub = roleChecked.find((el) => el.textContent.toLowerCase().includes('subscribe'));
          const once = roleChecked.find((el) => this.isOneTimePurchaseText(el.textContent));
          if (sub && once) return hasPlan ? sub : once;
          if (hasPlan) {
            return sub || roleChecked.find((el) => el.textContent.toLowerCase().includes('save')) || roleChecked[0];
          }
          return (
            once ||
            roleChecked.find((el) => !el.textContent.toLowerCase().includes('subscribe')) ||
            roleChecked[0]
          );
        }

        const pressed = [
          ...widget.querySelectorAll(
            'button[aria-pressed="true"], [role="button"][aria-pressed="true"], [aria-pressed="true"]'
          ),
        ].filter((el) => !isFrequencyRow(el) && looksLikePurchaseOption(el));
        if (pressed.length === 1) return pressed[0];
        if (pressed.length > 1) {
          const sub = pressed.find((el) => el.textContent.toLowerCase().includes('subscribe'));
          const once = pressed.find((el) => this.isOneTimePurchaseText(el.textContent));
          if (sub && once) return hasPlan ? sub : once;
          if (hasPlan) {
            return sub || pressed[0];
          }
          return once || pressed.find((el) => !el.textContent.toLowerCase().includes('subscribe')) || pressed[0];
        }

        const cr = widget.querySelector('input[type="radio"]:checked');
        if (cr) {
          return cr.closest('label') || cr.closest('[class*="option" i]') || cr.closest('div') || cr;
        }

        let labeled = null;
        try {
          labeled = widget.querySelector('label:has(input[type="radio"]:checked)');
        } catch (e) {
          labeled = null;
        }
        if (labeled) return labeled;

        return (
          widget.querySelector(
            '[data-headlessui-state="active"], [data-state="checked"], [class*="selected"][class*="purchase" i]'
          ) || null
        );
      }

      /** Selected purchase row (one-time or subscription) — price shown on that row. */
      extractPriceFromSelectedPurchaseRow() {
        const widget = this.findSubscriptionWidgetRoot();
        if (!widget) return null;
        const row = this.getSelectedPurchaseOptionRow(widget, this.getProductAtcForm());
        if (!row) return null;
        return this.extractLowestMoneyInScope(row);
      }

      /** Price shown for the selected subscription / selling plan (matches cart line when plan is selected). */
      getSellingPlanWidgetPriceText() {
        const form = this.getProductAtcForm();
        const hidden = form?.querySelector(
          'input[name="selling_plan"][type="hidden"], input[name="selling_plan"][type="text"], input[type="hidden"][name*="selling_plan" i], input[type="hidden"][name*="appstle" i]'
        );
        const hiddenHasPlan = !!(hidden && String(hidden.value || '').trim().length > 0);

        const fromRow = this.extractPriceFromSelectedPurchaseRow();
        if (fromRow) return fromRow;

        const sr =
          form?.querySelector('input[type="radio"][name="selling_plan"]:checked') ||
          this.querySelector('input[type="radio"][name="selling_plan"]:checked');
        if (sr && sr.value) {
          const scope =
            sr.closest('[class*="appstle" i]') ||
            sr.closest('fieldset') ||
            sr.closest('[role="radiogroup"]') ||
            sr.closest('label') ||
            sr.closest('div');
          const pr = this.extractLowestMoneyInScope(scope);
          if (pr) return pr;
        }

        if (hiddenHasPlan) {
          const widgetOnly = this.findSubscriptionWidgetRoot();
          if (widgetOnly) {
            const pr = this.extractLowestMoneyInScope(widgetOnly, {
              excludeClosest: [`#price-${this.dataset.section}`, '.product-form__buttons'],
            });
            if (pr) return pr;
          }
        }

        const widget = this.findSubscriptionWidgetRoot();
        if (widget) {
          const checked = widget.querySelector('input[type="radio"]:checked');
          if (checked) {
            const scope =
              checked.closest('[class*="appstle" i]') ||
              checked.closest('fieldset') ||
              checked.closest('[role="radiogroup"]') ||
              checked.closest('label') ||
              checked.closest('[class*="option"]') ||
              checked.closest('div') ||
              widget;
            const pr = this.extractLowestMoneyInScope(scope);
            if (pr) return pr;
          }
        }

        if (form) {
          const radios = form.querySelectorAll('input[type="radio"]:checked');
          for (const radio of radios) {
            if (!(radio instanceof HTMLInputElement)) continue;
            const nm = radio.name || '';
            if (nm.startsWith('options[')) continue;
            if (nm === 'id') continue;
            if (nm.startsWith('properties[')) continue;
            const scope =
              radio.closest('[class*="appstle" i]') ||
              radio.closest('[class*="subscription" i]') ||
              radio.closest('label') ||
              radio.closest('div');
            const pr = this.extractLowestMoneyInScope(scope, {
              excludeClosest: [`#price-${this.dataset.section}`, '.product-form__buttons'],
            });
            if (pr) return pr;
          }
        }

        const sel = this.querySelector('select[name="selling_plan"]');
        if (sel?.value) {
          const opt = sel.selectedOptions[0];
          const t = opt?.textContent?.trim() || '';
          const m = t.match(/[\$€£][\d,]+(?:\.\d{2})?/);
          if (m) return m[0];
        }

        return null;
      }

      getPriceBlockPriceText() {
        const priceContainer = this.querySelector(`#price-${this.dataset.section}`);
        if (!priceContainer) return null;
        const onSale = priceContainer.classList.contains('price--on-sale');
        let node = null;
        if (onSale) {
          node = priceContainer.querySelector('.price__sale .price-item--sale.price-item--last');
        } else {
          node = priceContainer.querySelector('.price__regular .price-item--regular');
        }
        return node?.textContent?.trim() || null;
      }

      /** Syncs `.product-form__submit-price`: subscription / selling plan first, then theme price block. */
      updateSubmitButtonPrice() {
        const submitPrice = this.querySelector('.product-form__submit-price');
        if (!submitPrice) return;

        const fromPlan = this.getSellingPlanWidgetPriceText();
        if (fromPlan) {
          submitPrice.textContent = fromPlan;
          return;
        }

        const fromBlock = this.getPriceBlockPriceText();
        if (fromBlock) submitPrice.textContent = fromBlock;
      }

      handleSwapProduct(productUrl, updateFullPage) {
        return (html) => {
          this.productModal?.remove();

          const selector = updateFullPage ? "product-info[id^='MainProduct']" : 'product-info';
          const variant = this.getSelectedVariant(html.querySelector(selector));
          this.updateURL(productUrl, variant?.id);

          if (updateFullPage) {
            document.querySelector('head title').innerHTML = html.querySelector('head title').innerHTML;

            HTMLUpdateUtility.viewTransition(
              document.querySelector('main'),
              html.querySelector('main'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          } else {
            HTMLUpdateUtility.viewTransition(
              this,
              html.querySelector('product-info'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          }
        };
      }

      renderProductInfo({ requestUrl, targetId, callback }) {
        this.abortController?.abort();
        this.abortController = new AbortController();

        fetch(requestUrl, { signal: this.abortController.signal })
          .then((response) => response.text())
          .then((responseText) => {
            this.pendingRequestUrl = null;
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            callback(html);
          })
          .then(() => {
            // set focus to last clicked option value
            document.querySelector(`#${targetId}`)?.focus();
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              console.log('Fetch aborted by user');
            } else {
              console.error(error);
            }
          });
      }

      getSelectedVariant(productInfoNode) {
        const selectedVariant = productInfoNode.querySelector('variant-selects [data-selected-variant]')?.innerHTML;
        return !!selectedVariant ? JSON.parse(selectedVariant) : null;
      }

      buildRequestUrlWithParams(url, optionValues, shouldFetchFullPage = false) {
        const params = [];

        !shouldFetchFullPage && params.push(`section_id=${this.sectionId}`);

        if (optionValues.length) {
          params.push(`option_values=${optionValues.join(',')}`);
        }

        return `${url}?${params.join('&')}`;
      }

      updateOptionValues(html) {
        const variantSelects = html.querySelector('variant-selects');
        if (variantSelects) {
          HTMLUpdateUtility.viewTransition(this.variantSelectors, variantSelects, this.preProcessHtmlCallbacks);
        }
      }

      handleUpdateProductInfo(productUrl) {
        return (html) => {
          const variant = this.getSelectedVariant(html);

          this.pickupAvailability?.update(variant);
          this.updateOptionValues(html);
          this.updateURL(productUrl, variant?.id);
          this.updateVariantInputs(variant?.id);

          if (!variant) {
            this.setUnavailable();
            return;
          }

          this.updateMedia(html, variant?.featured_media?.id);

          const updateSourceFromDestination = (id, shouldHide = (source) => false) => {
            const source = html.getElementById(`${id}-${this.sectionId}`);
            const destination = this.querySelector(`#${id}-${this.dataset.section}`);
            if (source && destination) {
              destination.innerHTML = source.innerHTML;
              destination.classList.toggle('hidden', shouldHide(source));
            }
          };

          const destSubmit = this.querySelector(`#ProductSubmitButton-${this.sectionId}`);
          const srcSubmit = html.getElementById(`ProductSubmitButton-${this.sectionId}`);
          if (destSubmit && srcSubmit) {
            const destSpan = destSubmit.querySelector('.product-form__submit-text');
            const srcSpan = srcSubmit.querySelector('.product-form__submit-text');
            if (destSpan && srcSpan) {
              destSpan.innerHTML = srcSpan.innerHTML;
            }
          }
          this.productForm?.refreshSubmitLabelTemplate?.();

          updateSourceFromDestination('price');
          updateSourceFromDestination('Sku', ({ classList }) => classList.contains('hidden'));
          updateSourceFromDestination('Inventory', ({ innerText }) => innerText === '');
          updateSourceFromDestination('Volume');
          updateSourceFromDestination('Price-Per-Item', ({ classList }) => classList.contains('hidden'));

          this.updateQuantityRules(this.sectionId, html);
          this.querySelector(`#Quantity-Rules-${this.dataset.section}`)?.classList.remove('hidden');
          this.querySelector(`#Volume-Note-${this.dataset.section}`)?.classList.remove('hidden');

          this.productForm?.toggleSubmitButton(
            html.getElementById(`ProductSubmitButton-${this.sectionId}`)?.hasAttribute('disabled') ?? true,
            window.variantStrings.soldOut
          );

          this.updateSubmitButtonPrice();

          publish(PUB_SUB_EVENTS.variantChange, {
            data: {
              sectionId: this.sectionId,
              html,
              variant,
            },
          });
        };
      }

      updateVariantInputs(variantId) {
        this.querySelectorAll(
          `#product-form-${this.dataset.section}, #product-form-installment-${this.dataset.section}`
        ).forEach((productForm) => {
          const input = productForm.querySelector('input[name="id"]');
          input.value = variantId ?? '';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }

      updateURL(url, variantId) {
        this.querySelector('share-button')?.updateUrl(
          `${window.shopUrl}${url}${variantId ? `?variant=${variantId}` : ''}`
        );

        if (this.dataset.updateUrl === 'false') return;
        window.history.replaceState({}, '', `${url}${variantId ? `?variant=${variantId}` : ''}`);
      }

      setUnavailable() {
        this.productForm?.toggleSubmitButton(true, window.variantStrings.unavailable);

        const selectors = ['price', 'Inventory', 'Sku', 'Price-Per-Item', 'Volume-Note', 'Volume', 'Quantity-Rules']
          .map((id) => `#${id}-${this.dataset.section}`)
          .join(', ');
        document.querySelectorAll(selectors).forEach(({ classList }) => classList.add('hidden'));
      }

      updateMedia(html, variantFeaturedMediaId) {
        if (!variantFeaturedMediaId) return;

        const mediaGallerySource = this.querySelector('media-gallery ul');
        const mediaGalleryDestination = html.querySelector(`media-gallery ul`);

        const refreshSourceData = () => {
          if (this.hasAttribute('data-zoom-on-hover')) enableZoomOnHover(2);
          const mediaGallerySourceItems = Array.from(mediaGallerySource.querySelectorAll('li[data-media-id]'));
          const sourceSet = new Set(mediaGallerySourceItems.map((item) => item.dataset.mediaId));
          const sourceMap = new Map(
            mediaGallerySourceItems.map((item, index) => [item.dataset.mediaId, { item, index }])
          );
          return [mediaGallerySourceItems, sourceSet, sourceMap];
        };

        if (mediaGallerySource && mediaGalleryDestination) {
          let [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();
          const mediaGalleryDestinationItems = Array.from(
            mediaGalleryDestination.querySelectorAll('li[data-media-id]')
          );
          const destinationSet = new Set(mediaGalleryDestinationItems.map(({ dataset }) => dataset.mediaId));
          let shouldRefresh = false;

          // add items from new data not present in DOM
          for (let i = mediaGalleryDestinationItems.length - 1; i >= 0; i--) {
            if (!sourceSet.has(mediaGalleryDestinationItems[i].dataset.mediaId)) {
              mediaGallerySource.prepend(mediaGalleryDestinationItems[i]);
              shouldRefresh = true;
            }
          }

          // remove items from DOM not present in new data
          for (let i = 0; i < mediaGallerySourceItems.length; i++) {
            if (!destinationSet.has(mediaGallerySourceItems[i].dataset.mediaId)) {
              mediaGallerySourceItems[i].remove();
              shouldRefresh = true;
            }
          }

          // refresh
          if (shouldRefresh) [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();

          // if media galleries don't match, sort to match new data order
          mediaGalleryDestinationItems.forEach((destinationItem, destinationIndex) => {
            const sourceData = sourceMap.get(destinationItem.dataset.mediaId);

            if (sourceData && sourceData.index !== destinationIndex) {
              mediaGallerySource.insertBefore(
                sourceData.item,
                mediaGallerySource.querySelector(`li:nth-of-type(${destinationIndex + 1})`)
              );

              // refresh source now that it has been modified
              [mediaGallerySourceItems, sourceSet, sourceMap] = refreshSourceData();
            }
          });
        }

        // set featured media as active in the media gallery
        this.querySelector(`media-gallery`)?.setActiveMedia?.(
          `${this.dataset.section}-${variantFeaturedMediaId}`,
          true
        );

        // update media modal
        const modalContent = this.productModal?.querySelector(`.product-media-modal__content`);
        const newModalContent = html.querySelector(`product-modal .product-media-modal__content`);
        if (modalContent && newModalContent) modalContent.innerHTML = newModalContent.innerHTML;
      }

      setQuantityBoundries() {
        const data = {
          cartQuantity: this.quantityInput.dataset.cartQuantity ? parseInt(this.quantityInput.dataset.cartQuantity) : 0,
          min: this.quantityInput.dataset.min ? parseInt(this.quantityInput.dataset.min) : 1,
          max: this.quantityInput.dataset.max ? parseInt(this.quantityInput.dataset.max) : null,
          step: this.quantityInput.step ? parseInt(this.quantityInput.step) : 1,
        };

        let min = data.min;
        const max = data.max === null ? data.max : data.max - data.cartQuantity;
        if (max !== null) min = Math.min(min, max);
        if (data.cartQuantity >= data.min) min = Math.min(min, data.step);

        this.quantityInput.min = min;

        if (max) {
          this.quantityInput.max = max;
        } else {
          this.quantityInput.removeAttribute('max');
        }
        this.quantityInput.value = min;

        publish(PUB_SUB_EVENTS.quantityUpdate, undefined);
      }

      fetchQuantityRules() {
        const currentVariantId = this.productForm?.variantIdInput?.value;
        if (!currentVariantId) return;

        this.querySelector('.quantity__rules-cart .loading__spinner').classList.remove('hidden');
        return fetch(`${this.dataset.url}?variant=${currentVariantId}&section_id=${this.dataset.section}`)
          .then((response) => response.text())
          .then((responseText) => {
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            this.updateQuantityRules(this.dataset.section, html);
          })
          .catch((e) => console.error(e))
          .finally(() => this.querySelector('.quantity__rules-cart .loading__spinner').classList.add('hidden'));
      }

      updateQuantityRules(sectionId, html) {
        if (!this.quantityInput) return;
        this.setQuantityBoundries();

        const quantityFormUpdated = html.getElementById(`Quantity-Form-${sectionId}`);
        const selectors = ['.quantity__input', '.quantity__rules', '.quantity__label'];
        for (let selector of selectors) {
          const current = this.quantityForm.querySelector(selector);
          const updated = quantityFormUpdated.querySelector(selector);
          if (!current || !updated) continue;
          if (selector === '.quantity__input') {
            const attributes = ['data-cart-quantity', 'data-min', 'data-max', 'step'];
            for (let attribute of attributes) {
              const valueUpdated = updated.getAttribute(attribute);
              if (valueUpdated !== null) {
                current.setAttribute(attribute, valueUpdated);
              } else {
                current.removeAttribute(attribute);
              }
            }
          } else {
            current.innerHTML = updated.innerHTML;
            if (selector === '.quantity__label') {
              const updatedAriaLabelledBy = updated.getAttribute('aria-labelledby');
              if (updatedAriaLabelledBy) {
                current.setAttribute('aria-labelledby', updatedAriaLabelledBy);
                // Update the referenced visually hidden element
                const labelId = updatedAriaLabelledBy;
                const currentHiddenLabel = document.getElementById(labelId);
                const updatedHiddenLabel = html.getElementById(labelId);
                if (currentHiddenLabel && updatedHiddenLabel) {
                  currentHiddenLabel.textContent = updatedHiddenLabel.textContent;
                }
              }
            }
          }
        }
      }

      get productForm() {
        return this.querySelector(`product-form`);
      }

      get productModal() {
        return document.querySelector(`#ProductModal-${this.dataset.section}`);
      }

      get pickupAvailability() {
        return this.querySelector(`pickup-availability`);
      }

      get variantSelectors() {
        return this.querySelector('variant-selects');
      }

      get relatedProducts() {
        const relatedProductsSectionId = SectionId.getIdForSection(
          SectionId.parseId(this.sectionId),
          'related-products'
        );
        return document.querySelector(`product-recommendations[data-section-id^="${relatedProductsSectionId}"]`);
      }

      get quickOrderList() {
        const quickOrderListSectionId = SectionId.getIdForSection(
          SectionId.parseId(this.sectionId),
          'quick_order_list'
        );
        return document.querySelector(`quick-order-list[data-id^="${quickOrderListSectionId}"]`);
      }

      get sectionId() {
        return this.dataset.originalSection || this.dataset.section;
      }
    }
  );
}
