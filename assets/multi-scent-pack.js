/**
 * Multi-pack scents: optional STICK 2/3 after "+ Mix scents"; otherwise duplicate primary scent per stick.
 */
(function () {
  /** @param {Element} productInfo */
  function getBundle(productInfo) {
    return productInfo.querySelector('.pack-scent-bundle[data-enable-pack-scents="true"]');
  }

  /** @param {Element} productInfo */
  function hasExtraScentSlots(productInfo) {
    return !!productInfo.querySelector('.pack-extra-scents .pack-scent-slot--2');
  }

  /** @param {Element} productInfo */
  function getPackSlots(productInfo) {
    const fieldset = productInfo.querySelector('.js-pack-quantity-fieldset');
    if (!fieldset) return 1;
    const select = fieldset.querySelector('select');
    if (select?.selectedOptions[0]?.dataset.packSlots != null) {
      const n = parseInt(select.selectedOptions[0].dataset.packSlots, 10);
      return Number.isFinite(n) && n >= 1 ? Math.min(3, n) : 1;
    }
    const radio = fieldset.querySelector('input[data-pack-slots]:checked');
    if (radio?.dataset.packSlots != null) {
      const n = parseInt(radio.dataset.packSlots, 10);
      return Number.isFinite(n) && n >= 1 ? Math.min(3, n) : 1;
    }
    return 1;
  }

  /** @param {Element | null} bundle */
  function isMixExpanded(bundle) {
    return bundle?.dataset.mixScentsExpanded === 'true';
  }

  /** @param {Element} productInfo */
  function readPrimaryScent(productInfo) {
    const fs = productInfo.querySelector('.js-primary-scent-fieldset');
    if (!fs) return '';
    const select = fs.querySelector('select');
    if (select?.selectedOptions[0]) return select.selectedOptions[0].value || '';
    const input = fs.querySelector('input:checked');
    return input ? input.value : '';
  }

  /** @param {Element} productInfo @param {number} slot */
  function readSlotScent(productInfo, slot) {
    const fieldset = productInfo.querySelector(`.pack-scent-slot--${slot}`);
    if (!fieldset) return '';
    const input = fieldset.querySelector(`input[name="properties[_Scent ${slot}]"]:checked`);
    return input ? input.value : '';
  }

  /** @param {Element} productInfo @param {number} slots @param {boolean} mixExpanded @param {boolean} hasSlots */
  function setSlotVisibility(productInfo, slots, mixExpanded, hasSlots) {
    if (!hasSlots) return;
    [2, 3].forEach((n) => {
      const fieldset = productInfo.querySelector(`.pack-scent-slot--${n}`);
      if (!fieldset) return;
      const visible = slots >= n && mixExpanded;
      fieldset.classList.toggle('hidden', !visible);
      fieldset.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.disabled = !visible;
      });
    });
  }

  /** @param {HTMLButtonElement} btn @param {boolean} expanded */
  function setMixButtonLabels(btn, expanded) {
    const showEl = btn.querySelector('.js-mix-scents-label-show');
    const hideEl = btn.querySelector('.js-mix-scents-label-hide');
    if (showEl) showEl.classList.toggle('hidden', expanded);
    if (hideEl) hideEl.classList.toggle('hidden', !expanded);
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  /** @param {Element} productInfo @param {number} slots @param {boolean} mixExpanded @param {boolean} hasSlots */
  function updateMixButtons(productInfo, slots, mixExpanded, hasSlots) {
    productInfo.querySelectorAll('.js-mix-scents-toggle').forEach((btn) => {
      if (!(btn instanceof HTMLButtonElement)) return;
      const show = hasSlots && slots >= 2;
      btn.classList.toggle('hidden', !show);
      if (show) setMixButtonLabels(btn, mixExpanded);
    });
  }

  /** @param {Element} productInfo @param {number} slots @param {boolean} mixExpanded @param {boolean} hasSlots */
  function updatePrimaryHeading(productInfo, slots, mixExpanded, hasSlots) {
    const bundle = getBundle(productInfo);
    const singular = bundle?.dataset?.scentHeadingSingular || 'Scent';

    productInfo.querySelectorAll('.js-primary-scent-heading').forEach((heading) => {
      const swatch = heading.classList.contains('js-primary-scent-heading--swatch');
      let label;

      if (slots === 1) {
        label = singular;
      } else if (hasSlots && !mixExpanded) {
        label = singular;
      } else {
        label = 'STICK 1';
      }

      heading.textContent = swatch ? `${label}:` : label;
    });
  }

  /** @param {Element} productInfo */
  function updateScentsHidden(productInfo) {
    const sectionId = productInfo.dataset.section;
    const hidden = document.getElementById(`PackScentsSummary-${sectionId}`);
    if (!hidden) return;

    const bundle = getBundle(productInfo);
    const slots = getPackSlots(productInfo);
    const primary = readPrimaryScent(productInfo);
    const hasSlots = hasExtraScentSlots(productInfo);
    const mixExpanded = hasSlots && isMixExpanded(bundle);

    if (slots < 2) {
      hidden.value = primary;
      hidden.disabled = !primary;
      return;
    }

    if (!primary) {
      hidden.value = '';
      hidden.disabled = true;
      return;
    }

    if (!hasSlots || !mixExpanded) {
      hidden.value = Array.from({ length: slots }, () => primary).join(', ');
      hidden.disabled = false;
      return;
    }

    const parts = [primary];
    if (slots >= 2) parts.push(readSlotScent(productInfo, 2) || primary);
    if (slots >= 3) parts.push(readSlotScent(productInfo, 3) || primary);
    hidden.value = parts.join(', ');
    hidden.disabled = false;
  }

  /** @param {Element} productInfo */
  function refresh(productInfo) {
    const bundle = getBundle(productInfo);
    if (!bundle) return;

    if (bundle.dataset.mixScentsExpanded == null) {
      bundle.dataset.mixScentsExpanded = 'false';
    }

    const slots = getPackSlots(productInfo);
    const hasSlots = hasExtraScentSlots(productInfo);

    if (slots < 2) {
      bundle.dataset.mixScentsExpanded = 'false';
    }

    const mixExpanded = hasSlots && isMixExpanded(bundle);

    setSlotVisibility(productInfo, slots, mixExpanded, hasSlots);
    updateMixButtons(productInfo, slots, mixExpanded, hasSlots);
    updatePrimaryHeading(productInfo, slots, mixExpanded, hasSlots);
    updateScentsHidden(productInfo);
  }

  function bindProductInfo(productInfo) {
    if (!getBundle(productInfo)) return;
    refresh(productInfo);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('product-info').forEach(bindProductInfo);
  });

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.js-mix-scents-toggle');
    if (!(btn instanceof HTMLButtonElement)) return;
    const productInfo = btn.closest('product-info');
    const bundle = productInfo ? getBundle(productInfo) : null;
    if (!productInfo || !bundle || !hasExtraScentSlots(productInfo)) return;

    const next = !isMixExpanded(bundle);
    bundle.dataset.mixScentsExpanded = next ? 'true' : 'false';
    refresh(productInfo);
  });

  document.addEventListener('change', (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLSelectElement)) return;
    const productInfo = t.closest('product-info');
    if (!productInfo || !getBundle(productInfo)) return;

    if (t.closest('.js-pack-quantity-fieldset')) {
      refresh(productInfo);
      return;
    }
    if (t.closest('.js-primary-scent-fieldset')) {
      refresh(productInfo);
      return;
    }
    if (t.closest('.pack-extra-scents')) {
      refresh(productInfo);
      return;
    }
  });

  if (typeof subscribe !== 'undefined' && typeof PUB_SUB_EVENTS !== 'undefined') {
    subscribe(PUB_SUB_EVENTS.variantChange, (event) => {
      const sectionId = event?.data?.sectionId;
      if (!sectionId) return;
      const productInfo = document.querySelector(`product-info[data-section="${sectionId}"]`);
      if (productInfo) requestAnimationFrame(() => refresh(productInfo));
    });
  }

  document.addEventListener('shopify:section:load', (event) => {
    event.target.querySelectorAll?.('product-info').forEach(bindProductInfo);
  });
})();
