/**
 * Nonomic Judge.me reviews â€” Figma layout shell around the Judge.me review widget.
 */
(function () {
  const SECTION_SELECTOR = '[data-njr-section]';
  const REVIEWS_ANCHOR_ID = 'nonomic-product-reviews';
  const DEFAULT_REVIEWS_PER_PAGE = 8;
  const njrInstances = new WeakMap();
  const STAR_SVG =
    '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';

  class NonomicJudgeMeReviews {
    constructor(root) {
      this.root = root;
      this.productId = root.dataset.productId || '';
      this.isExternalProduct = root.dataset.njrExternalProduct === 'true';
      this._externalInitAttempted = false;
      this._externalReviewsLoaded = false;
      this.searchQuery = '';
      this.scentFilter = 'all';
      this.sortKey = 'newest';
      this.searchDebounceTimer = null;
      this._listRequestId = 0;
      this._customListActive = false;
      this._customListPage = 1;
      this._allReviewsCache = null;
      this._reviewBodyByUuid = new Map();
      this._reviewTitleByUuid = new Map();
      this.enhanced = false;
      this.mo = null;
      this.init();
    }

    init() {
      this.cacheEls();
      this.bindShellEvents();
      this.waitForWidget();
      if (this.isExternalProduct && this.productId) {
        this.loadExternalProductReviews();
      }
    }

    isWidgetReady(widget) {
      if (!widget) return false;
      if (widget.querySelector('.jm-review-item')) return true;

      if (this.isExternalProduct) {
        const data = this.getWidgetData();
        return Boolean(
          (Array.isArray(data?.reviews) && data.reviews.length) ||
            data?.average_rating != null ||
            data?.number_of_reviews > 0
        );
      }

      return widget.classList.contains('jdgm--done-setup-widget');
    }

    ensureWidgetListStructure() {
      const widget =
        this.widget ||
        this.els.widgetSlot?.querySelector('#judgeme_product_reviews, .jdgm-review-widget');
      if (!widget) return null;

      this.widget = widget;

      if (!widget.querySelector('.jdgm-review-list')) {
        const host = document.createElement('div');
        host.className = 'jm-review-widget';
        const list = document.createElement('div');
        list.className = 'jdgm-review-list';
        host.appendChild(list);

        const pagination = document.createElement('div');
        pagination.className = 'jm-pagination-controls';
        const cluster = document.createElement('div');
        cluster.className = 'jm-cluster';
        pagination.appendChild(cluster);
        host.appendChild(pagination);

        widget.appendChild(host);
      }

      return widget;
    }

    async loadExternalProductReviews() {
      if (!this.isExternalProduct || !this.productId || this._externalReviewsLoaded) return;

      await this.waitForJdgm();
      this.initExternalProductWidget();

      const widget = this.ensureWidgetListStructure();
      if (!widget) return;

      await new Promise((resolve) => window.setTimeout(resolve, 1200));

      if (this.isWidgetReady(widget) && widget.querySelector('.jm-review-item')) {
        this._externalReviewsLoaded = true;
        if (!this.enhanced) this.enhance();
        return;
      }

      const page1 = await this.requestWidgetPage(1, { includeSearch: false });
      if (!page1?.reviews?.length) return;

      this.mergeWidgetReviewPayload(page1);
      this._allReviewsCache = null;
      const all = await this.collectAllReviews({ force: true });
      if (!all?.length) return;

      this._externalReviewsLoaded = true;
      this.ensureWidgetListStructure();
      this.renderCustomResultsPage(1);

      if (!this.enhanced) {
        this.enhance({ skipBootstrap: true });
      }

      this.populateHeader();
      this.restylePagination();
      this.injectHiddenWriteReviewButton();
    }

    cacheEls() {
      this.els = {
        average: this.root.querySelector('[data-njr-average]'),
        count: this.root.querySelector('[data-njr-count]'),
        headerStars: this.root.querySelector('[data-njr-header-stars]'),
        histogram: this.root.querySelector('[data-njr-histogram]'),
        widgetSlot: this.root.querySelector('[data-njr-widget-slot]'),
        search: this.root.querySelector('[data-njr-search]'),
        writeBtn: this.root.querySelector('[data-njr-write-review]'),
        filterBtn: this.root.querySelector('[data-njr-filter-open]'),
        drawer: this.root.querySelector('[data-njr-drawer]'),
        drawerClose: this.root.querySelectorAll('[data-njr-drawer-close]'),
        drawerApply: this.root.querySelector('[data-njr-drawer-apply]'),
        sortInputs: this.root.querySelectorAll('[data-njr-sort]'),
        scentInputs: this.root.querySelectorAll('[data-njr-scent]'),
      };
    }

    bindShellEvents() {
      const onSearchChange = (value) => {
        this.searchQuery = String(value || '').trim();
        window.clearTimeout(this.searchDebounceTimer);

        if (!this.searchQuery) {
          this.restoreDefaultReviews();
          return;
        }

        this.searchDebounceTimer = window.setTimeout(() => this.applySearch(), 400);
      };

      this.els.search?.addEventListener('input', (e) => onSearchChange(e.target.value));
      this.els.search?.addEventListener('search', (e) => onSearchChange(e.target.value));

      this.els.writeBtn?.addEventListener('click', (event) => {
        if (this.els.writeBtn?.hasAttribute('data-njr-write-review-external-link')) {
          return;
        }
        event.preventDefault();
        this.openWriteReview();
      });

      this.els.filterBtn?.addEventListener('click', () => this.openDrawer());

      this.els.drawerClose?.forEach((el) => {
        el.addEventListener('click', () => this.closeDrawer());
      });

      this.els.drawerApply?.addEventListener('click', () => {
        this.syncDrawerToSidebar();
        this.closeDrawer();
      });

      this.els.sortInputs?.forEach((input) => {
        input.addEventListener('change', () => {
          if (!input.checked) return;
          this.sortKey = input.value;
          this.syncRadios('[data-njr-sort]', input.value);
          this.applySort();
        });
      });

      this.els.scentInputs?.forEach((input) => {
        input.addEventListener('change', () => {
          if (!input.checked) return;
          this.scentFilter = input.value;
          this.syncRadios('[data-njr-scent]', input.value);
          this.applyScentFilter();
        });
      });
    }

    findNativeWriteReviewButton() {
      const roots = [this.widget, this.els.widgetSlot].filter(Boolean);
      const selectors = [
        '[data-testid="write-review-button"]',
        '.jm-action-buttons__button',
        '.jdgm-write-review-link',
        '.jdgm-write-rev-link',
        '[data-jdgm-write-review]',
      ];

      for (const root of roots) {
        for (const selector of selectors) {
          const btn = root.querySelector(selector);
          if (btn) return btn;
        }
      }

      return null;
    }

    injectHiddenWriteReviewButton() {
      if (!this.widget || !this.productId) return null;

      const existing = this.findNativeWriteReviewButton();
      if (existing) return existing;

      let host = this.widget.querySelector('.jm-action-buttons');
      if (!host) {
        host = document.createElement('div');
        host.className = 'jm-action-buttons';
        host.setAttribute('aria-hidden', 'true');
        host.hidden = true;
        this.widget.appendChild(host);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jm-action-buttons__button';
      btn.setAttribute('data-testid', 'write-review-button');
      btn.textContent = 'Write a review';
      host.appendChild(btn);
      return btn;
    }

    isWriteReviewModalOpen() {
      const modal = document.querySelector(
        '.jdgm-write-review-modal, .jdgm-review-form-modal, [class*="write-review-modal"]'
      );
      if (!modal) return false;
      const style = window.getComputedStyle(modal);
      return style.display !== 'none' && style.visibility !== 'hidden' && modal.offsetParent !== null;
    }

    getProductWriteReviewUrl() {
      let url = (this.root.dataset.productUrl || '').trim();
      if (!url) return '';

      if (/^https?:\/\//i.test(url)) {
        return url.split('#')[0].split('?')[0];
      }

      if (url.startsWith('//')) {
        return `${window.location.protocol}${url}`.split('#')[0].split('?')[0];
      }

      if (url.startsWith('/')) {
        return `${window.location.origin}${url}`.split('#')[0].split('?')[0];
      }

      return `${window.location.origin}/${url}`.split('#')[0].split('?')[0];
    }

    tryJudgeMeWriteReviewApis() {
      const jdgm = window.jdgm || window.judgeme;
      const id = this.getProductId();
      if (!jdgm || !id) return false;

      const widget = this.widget || this.els.widgetSlot?.querySelector('.jdgm-review-widget');
      const attempts = [
        () => jdgm.widget?.openWriteReviewForm?.(id, widget),
        () => jdgm.WIDGET?.openWriteReviewForm?.(id, widget),
        () => jdgm.openWriteReviewForm?.(id),
        () => jdgm.openWriteReview?.(id),
        () => jdgm.reviews?.openWriteReviewForm?.(id),
        () => jdgm.customize?.openWriteReviewForm?.(id),
      ];

      for (const attempt of attempts) {
        try {
          const result = attempt();
          if (result) return true;
        } catch (error) {
          /* try next Judge.me API */
        }
      }

      return false;
    }

    redirectToProductWriteReview() {
      const base = this.getProductWriteReviewUrl();
      if (!base) return false;

      window.location.href = `${base}#${REVIEWS_ANCHOR_ID}-write`;
      return true;
    }

    openWriteReview() {
      if (this.isExternalProduct) {
        this.redirectToProductWriteReview();
        return;
      }

      const nativeBtn =
        this.findNativeWriteReviewButton() || this.injectHiddenWriteReviewButton();
      if (nativeBtn) {
        nativeBtn.click();
        return;
      }

      this.tryJudgeMeWriteReviewApis();
    }

    openDrawer() {
      this.els.drawer?.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }

    closeDrawer() {
      this.els.drawer?.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    syncRadios(selector, value) {
      this.root.querySelectorAll(`${selector}[value="${value}"]`).forEach((el) => {
        el.checked = true;
      });
    }

    syncDrawerToSidebar() {
      const drawerSort = this.els.drawer?.querySelector('[data-njr-sort]:checked');
      const drawerScent = this.els.drawer?.querySelector('[data-njr-scent]:checked');
      if (drawerSort) {
        this.sortKey = drawerSort.value;
        this.syncRadios('[data-njr-sort]', drawerSort.value);
        this.applySort();
      }
      if (drawerScent) {
        this.scentFilter = drawerScent.value;
        this.syncRadios('[data-njr-scent]', drawerScent.value);
        this.applyClientFilters();
      }
    }

    waitForJdgm(timeout = 10000) {
      return new Promise((resolve) => {
        if (window.jdgm) {
          resolve(window.jdgm);
          return;
        }
        const started = Date.now();
        const timer = window.setInterval(() => {
          if (window.jdgm) {
            window.clearInterval(timer);
            resolve(window.jdgm);
          } else if (Date.now() - started > timeout) {
            window.clearInterval(timer);
            resolve(null);
          }
        }, 120);
      });
    }

    initExternalProductWidget() {
      if (!this.isExternalProduct || !this.productId || this._externalInitAttempted) return;
      this._externalInitAttempted = true;

      const slot = this.els.widgetSlot;
      let widget =
        slot?.querySelector('#judgeme_product_reviews') ||
        slot?.querySelector('.jdgm-review-widget');

      if (!widget) {
        const host = slot?.querySelector('[data-njr-judgeme-fallback]') || slot;
        if (!host) return;
        widget = document.createElement('div');
        widget.id = 'judgeme_product_reviews';
        widget.className = 'jdgm-widget jdgm-review-widget';
        host.appendChild(widget);
      }

      widget.dataset.id = this.productId;
      widget.dataset.productId = this.productId;

      const runSetup = (jdgm) => {
        if (!jdgm) return;
        if (jdgm.$) {
          const $root = jdgm.$(widget);
          $root.data('id', this.productId);
          $root.data('productId', this.productId);
        }
        if (typeof jdgm.widget?.setup === 'function') jdgm.widget.setup(widget);
        else if (typeof jdgm.WIDGET?.setup === 'function') jdgm.WIDGET.setup(widget);
        else if (typeof jdgm.renderWidget === 'function') jdgm.renderWidget(widget);
        else if (typeof jdgm.loadWidgets === 'function') jdgm.loadWidgets();
        jdgm.triggerEvent?.('reviewWidget:setup');
      };

      if (window.jdgm) runSetup(window.jdgm);
      else this.waitForJdgm().then(runSetup);
    }

    waitForWidget() {
      const tryEnhance = () => {
        const widget =
          this.els.widgetSlot?.querySelector('#judgeme_product_reviews') ||
          this.els.widgetSlot?.querySelector('.jdgm-review-widget');
        if (!widget) return false;
        if (!this.isWidgetReady(widget)) return false;
        this.widget = widget;
        if (!this.productId) {
          this.productId = widget.dataset.productId || widget.dataset.id || '';
        }
        if (!this.enhanced) {
          this.enhance();
        } else {
          this.refreshReviews();
        }
        return true;
      };

      if (tryEnhance()) return;

      this.mo = new MutationObserver(() => {
        if (tryEnhance()) {
          this.mo?.disconnect();
          return;
        }
        if (this.isExternalProduct && this.productId && !this._externalInitAttempted) {
          const widget =
            this.els.widgetSlot?.querySelector('#judgeme_product_reviews, .jdgm-review-widget');
          if (widget && !widget.querySelector('.jm-review-item')) {
            this.initExternalProductWidget();
          }
        }
      });
      this.mo.observe(this.els.widgetSlot, { childList: true, subtree: true });

      window.setTimeout(() => {
        if (this.enhanced) return;
        if (tryEnhance()) return;
        if (this.isExternalProduct && this.productId) {
          this.initExternalProductWidget();
        }
      }, 2500);
    }

    getProductId() {
      if (this.productId) return this.productId;
      const widget =
        this.widget ||
        this.els.widgetSlot?.querySelector('#judgeme_product_reviews, .jdgm-review-widget');
      const id = widget?.dataset?.productId || widget?.dataset?.id || '';
      if (id) this.productId = String(id);
      return this.productId;
    }

    parseWidgetDataScript() {
      const script = document.querySelector('script.jdgm-review-widget-data');
      if (!script?.textContent) return null;
      const id = this.getProductId();
      if (!id) return null;
      try {
        const re = new RegExp(
          `jdgm\\.data\\.reviewWidget\\[${id}\\]\\s*=\\s*(\\{[\\s\\S]*?\\});`
        );
        const match = script.textContent.match(re);
        if (match?.[1]) return JSON.parse(match[1]);
      } catch (error) {
        /* ignore malformed script payload */
      }
      return null;
    }

    getWidgetData() {
      const store = window.jdgm?.data?.reviewWidget;
      const id = this.getProductId();
      if (store && id) {
        const data =
          store[id] || store[String(id)] || store[Number(id)] || null;
        if (data) return data;
      }
      return this.parseWidgetDataScript();
    }

    enhance({ skipBootstrap = false } = {}) {
      this.enhanced = true;
      this.root.classList.add('njr--enhanced', 'njr--ready');
      this.els.widgetSlot?.classList.add('njr__widget-slot--ready');
      this.populateHeader();
      this.watchForReviewData();
      this.wrapReviewItems();
      this.restylePagination();
      this.dismissLoadingOverlay();
      this.bindWidgetPaginationPersistence();
      this.observeListChanges();
      if (!skipBootstrap) this.bootstrapCustomList();
    }

    dismissLoadingOverlay() {
      this.widget?.querySelectorAll('.jm-loading-overlay').forEach((el) => {
        el.style.pointerEvents = 'none';
        el.style.minHeight = '0';
        const spinner = el.querySelector('[class*="spinner"], [class*="loading"]');
        if (spinner) spinner.remove();
      });
    }

    populateHeader() {
      const data = this.getWidgetData();
      const avg = data ? parseFloat(data.average_rating) : NaN;

      if (this.els.average && !Number.isNaN(avg)) {
        this.els.average.textContent = avg.toFixed(1);
      }

      const count = this.getReviewCount(data);
      if (this.els.count && count != null) {
        this.els.count.textContent = this.formatReviewCountLabel(count);
      }

      if (this.els.headerStars) {
        const full = Math.round(avg) || 5;
        this.els.headerStars.innerHTML = Array.from({ length: 5 }, (_, i) =>
          i < full
            ? `<span class="njr__header-star">${STAR_SVG}</span>`
            : `<span class="njr__header-star njr__header-star--empty">${STAR_SVG}</span>`
        ).join('');
      }

      this.renderHistogram(data);
    }

    renderHistogram(data) {
      if (!this.els.histogram) return;

      const histogram = data?.histogram;
      if (!Array.isArray(histogram) || !histogram.length) return;

      const totalReviews =
        Number(data.number_of_reviews) ||
        histogram.reduce((sum, row) => sum + (Number(row.frequency) || 0), 0);

      const rows = [...histogram].sort((a, b) => Number(b.rating) - Number(a.rating));

      this.els.histogram.innerHTML = rows
        .map((row) => {
          const freq = Number(row.frequency) || 0;
          let pct = Number(row.percentage);
          if ((Number.isNaN(pct) || pct <= 0) && freq > 0 && totalReviews > 0) {
            pct = (freq / totalReviews) * 100;
          }
          pct = Math.min(100, Math.max(0, pct || 0));

          return `
            <div class="njr__histogram-row">
              <div class="njr__histogram-label">
                <span>${row.rating}</span>
                <span class="njr__histogram-star">${STAR_SVG}</span>
              </div>
              <div class="njr__histogram-track" data-fill="${pct}" style="--njr-fill:${pct}%;">
                <span class="njr__histogram-fill" style="width:${pct}%;" aria-hidden="true"></span>
              </div>
              <span class="njr__histogram-freq">${this.formatNumber(freq)}</span>
            </div>`;
        })
        .join('');
    }

    formatNumber(n) {
      return Number(n).toLocaleString();
    }

    getReviewCount(data) {
      if (data?.number_of_reviews != null) return data.number_of_reviews;

      const initial = this.root.dataset.initialReviewCount;
      if (initial !== undefined && initial !== '') {
        const parsed = Number(initial);
        if (!Number.isNaN(parsed)) return parsed;
      }

      const widgetCount = this.widget?.querySelector('.jm-average-rating-display .jm-text')?.textContent;
      const match = widgetCount?.match(/(\d[\d,]*)\s*review/i);
      if (match) return Number(match[1].replace(/,/g, ''));

      return null;
    }

    formatReviewCountLabel(count) {
      let label = this.root.dataset.reviewsCountLabel || 'Based on [count] reviews';
      label = label.replace(/\{\{\s*count\s*\}\}/gi, '[count]');
      return label.replace(/\[count\]/gi, this.formatNumber(count));
    }

    watchForReviewData() {
      if (this.headerDataInterval) return;

      let attempts = 0;
      this.headerDataInterval = window.setInterval(() => {
        attempts += 1;
        const data = this.getWidgetData();
        this.populateHeader();

        const histogramReady =
          !Array.isArray(data?.histogram) ||
          data.histogram.length === 0 ||
          Boolean(this.els.histogram?.querySelector('.njr__histogram-track[data-fill]'));

        if (histogramReady || attempts > 80) {
          window.clearInterval(this.headerDataInterval);
          this.headerDataInterval = null;
        }
      }, 250);
    }

    wrapReviewItems() {
      const items = this.widget?.querySelectorAll('.jm-review-item');
      if (!items?.length) return;

      items.forEach((item) => {
        const uuid = item.getAttribute('review-uuid') || '';
        const data = this.findReviewData(uuid);
        this.buildFigmaReviewCard(item, data);
        item.dataset.njrScent = this.resolveScentSlug(data, item);
        item.dataset.njrSearchText = this.buildSearchText(item, data);
      });

      this.syncReviewDividers();
    }

    buildFigmaReviewCard(item, data) {
      const review = this.normalizeReviewRecord(data, item);
      const rating = review?.rating ?? this.getRatingFromItem(item);
      const title =
        review?.title ||
        this.extractReviewTitle(review) ||
        item.querySelector('.review-card__title, .jm-review-content__title, .jdgm-review-title')
          ?.textContent?.trim() ||
        '';
      const body = review?.body || this.getReviewBody(review, item);
      const name = this.getReviewerName(item, review);
      const dateText = this.getReviewDate(item, review);
      const verified = this.isVerifiedReview(item, review);
      const verifiedLabel = this.root.dataset.njrVerifiedLabel || 'âœ“ Verified Customer';

      let card = item.querySelector(':scope > .review-card');
      if (!card) {
        card = document.createElement('article');
        card.className = 'review-card';
        item.appendChild(card);
      }

      card.innerHTML = `
        <div class="review-stars" role="img" aria-label="${rating} out of 5 stars">
          ${this.buildStarsHtml(rating)}
        </div>
        <h3 class="review-card__title">${this.escapeHtml(title)}</h3>
        <p class="review-card__body">${this.escapeHtml(body)}</p>
        <div class="review-card__meta">
          <span class="review-card__author">${this.escapeHtml(name)}</span>
          ${verified ? `<span class="review-card__verified">${this.escapeHtml(verifiedLabel)}</span>` : ''}
          <span class="review-card__date">${this.escapeHtml(dateText)}</span>
        </div>
      `;

      this.hideJudgeMeReviewChrome(item);
    }

    buildStarsHtml(rating) {
      const count = Math.min(5, Math.max(0, Math.round(Number(rating) || 5)));
      const star =
        '<svg class="review-stars__icon" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
      return star.repeat(count);
    }

    hideJudgeMeReviewChrome(item) {
      Array.from(item.children).forEach((child) => {
        if (child.classList.contains('review-card')) return;
        child.setAttribute('hidden', '');
        child.setAttribute('aria-hidden', 'true');
      });
    }

    getRatingFromItem(item) {
      const label = item.querySelector('.jm-star-rating')?.getAttribute('aria-label');
      const match = label?.match(/(\d+)\s*out\s*of\s*5/i);
      return match ? Number(match[1]) : 5;
    }

    stripHtml(html) {
      if (!html) return '';
      const tmp = document.createElement('div');
      tmp.innerHTML = String(html);
      return tmp.textContent?.trim() || '';
    }

    extractReviewBody(review) {
      if (!review) return '';

      const candidates = [
        review.body,
        review.body_html,
        review.body_text,
        review.content,
        review.review,
        review.review_content,
        review.review_body,
        review.message,
        review.snippet,
      ];

      for (const candidate of candidates) {
        const text = this.stripHtml(candidate);
        if (text) return text;
      }

      return '';
    }

    extractReviewTitle(review) {
      if (!review) return '';

      const candidates = [
        review.title,
        review.review_title,
        review.headline,
        review.title_html,
        review.subject,
      ];

      for (const candidate of candidates) {
        const text = this.stripHtml(candidate);
        if (text) return text;
      }

      return '';
    }

    normalizeReviewRecord(review, item) {
      if (!review) return review;

      const uuid = String(review.uuid || review.id || item?.getAttribute?.('review-uuid') || '');
      const fromDomBody =
        item?.querySelector?.('.review-card__body, .jm-review-content__body, .jm-review-content__body-content, .jdgm-review-content__body-content')
          ?.textContent?.trim() || '';
      const fromDomTitle =
        item?.querySelector?.('.review-card__title, .jm-review-content__title, .jdgm-review-title')
          ?.textContent?.trim() || '';
      const cachedBody = uuid ? this._reviewBodyByUuid.get(uuid) : '';
      const cachedTitle = uuid ? this._reviewTitleByUuid.get(uuid) : '';
      const body = this.extractReviewBody(review) || fromDomBody || cachedBody || '';
      const title = this.extractReviewTitle(review) || fromDomTitle || cachedTitle || '';

      if (uuid && body) {
        this._reviewBodyByUuid.set(uuid, body);
      }
      if (uuid && title) {
        this._reviewTitleByUuid.set(uuid, title);
      }

      return {
        ...review,
        uuid: review.uuid || review.id || uuid,
        title,
        body,
        reviewer_name:
          review.reviewer_name ||
          review.name ||
          review.reviewer?.name ||
          review.user_name ||
          'Customer',
        created_at: review.created_at || review.created_at_iso || review.user_friendly_created_at || '',
        rating: review.rating ?? review.score ?? review.stars,
        product_variant_title: review.product_variant_title || review.variant_title || '',
      };
    }

    getReviewBody(data, item) {
      const normalized = this.normalizeReviewRecord(data, item);
      if (normalized?.body) return normalized.body;

      const bodyEl = item?.querySelector?.(
        '.review-card__body, .jm-review-content__body, .jm-review-content__body-content, .jdgm-review-content__body-content'
      );
      return bodyEl?.textContent?.trim() || '';
    }

    syncReviewDividers() {
      const list = this.widget?.querySelector('.jdgm-review-list');
      if (!list) return;

      list.querySelectorAll('.njr__review-divider').forEach((el) => el.remove());

      const items = list.querySelectorAll('.jm-review-item');
      items.forEach((item, index) => {
        if (index >= items.length - 1) return;
        const divider = document.createElement('hr');
        divider.className = 'njr__review-divider';
        divider.setAttribute('aria-hidden', 'true');
        item.after(divider);
      });
    }

    findReviewData(uuid) {
      if (!uuid) return null;

      const pools = [this.getWidgetData()?.reviews, this._allReviewsCache];

      let best = null;

      for (const pool of pools) {
        if (!Array.isArray(pool)) continue;
        const match = pool.find((r) => r.uuid === uuid || String(r.id) === uuid);
        if (!match) continue;

        const normalized = this.normalizeReviewRecord(match);
        if (!best) {
          best = normalized;
          continue;
        }

        best = {
          ...best,
          ...normalized,
          body: normalized.body || best.body,
          title: normalized.title || best.title,
        };
      }

      return best;
    }

    resolveScentSlug(data, item) {
      const mapRaw = this.root.dataset.scentMap || '';
      const maps = mapRaw
        .split('|')
        .map((pair) => pair.split(':').map((s) => s.trim()))
        .filter((p) => p.length === 2);

      const haystack = [
        data?.product_variant_title,
        data?.title,
        data?.body,
        item.textContent,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      for (const [slug, keywords] of maps) {
        if (slug === 'all') continue;
        const keys = keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
        if (keys.some((k) => haystack.includes(k))) return slug;
      }
      return 'all';
    }

    buildSearchText(item, data) {
      const card = item.querySelector('.review-card');
      if (card) return card.textContent.toLowerCase();
      return [
        data?.title,
        data?.body,
        data?.reviewer_name,
        item.querySelector('.jm-review-content__title')?.textContent,
        item.querySelector('.jm-review-content__body')?.textContent,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    }

    getReviewerName(item, data) {
      return (
        data?.reviewer_name ||
        item.querySelector('.jm-reviewer-info__name')?.textContent?.trim() ||
        'Customer'
      );
    }

    getReviewDate(item, data) {
      const fromData = this.formatReviewDate(data?.created_at);
      if (fromData) return fromData;

      const details = item.querySelector('.jm-reviewer-info__details');
      if (details) {
        const texts = details.querySelectorAll('.jm-text');
        for (let i = texts.length - 1; i >= 0; i -= 1) {
          const text = texts[i].textContent?.trim();
          if (text && !texts[i].classList.contains('jm-reviewer-info__name')) {
            return text;
          }
        }
      }

      return '';
    }

    formatReviewDate(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }

    isVerifiedReview(item, data) {
      if (data?.verified_buyer === true) return true;
      if (this.root.dataset.njrShowVerified === 'true') return true;
      return Boolean(
        item.querySelector(
          '[class*="verified"], [data-verified="true"], .jm-verified-buyer-badge'
        )
      );
    }

    escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    getJudgeMeWidgetRoot() {
      return (
        this.els.widgetSlot?.querySelector('#judgeme_product_reviews') ||
        this.widget?.closest('#judgeme_product_reviews, .jdgm-review-widget') ||
        this.widget
      );
    }

    getShopParams() {
      const jdgm = window.jdgm;
      if (typeof jdgm?.shopParams === 'function') {
        return jdgm.shopParams();
      }
      return {
        shop_domain: this.root.dataset.shopDomain || window.Shopify?.shop || '',
        platform: 'shopify',
      };
    }

    getWidgetFetchUrlCandidates() {
      const urls = [];
      const root = this.getJudgeMeWidgetRoot();
      const slot = this.els.widgetSlot;
      const jdgm = window.jdgm;

      const push = (url) => {
        if (url && !urls.includes(url)) urls.push(url);
      };

      if (jdgm?.$ && root) {
        const $root = jdgm.$(root);
        push($root.find('.jdgm-paginate').data('url'));
        push($root.data('url'));
      }

      push(root?.dataset?.url);
      push(slot?.querySelector('[data-url]')?.dataset?.url);
      push(slot?.querySelector('.jdgm-paginate')?.dataset?.url);
      push(jdgm?.API_HOST ? `${jdgm.API_HOST}/reviews/reviews_for_widget` : null);
      push('https://api.judge.me/reviews/reviews_for_widget');
      push('https://judge.me/reviews/reviews_for_widget');

      return urls;
    }

    getWidgetFetchUrl() {
      return this.getWidgetFetchUrlCandidates()[0] || null;
    }

    getJudgeMeSearchInput() {
      return (
        this.els.widgetSlot?.querySelector(
          '.jdgm-review-search, .jm-search-filter input, .jm-search-filter__input, [data-testid*="search"] input, input[name="search"], input[type="search"]'
        ) ||
        this.widget?.querySelector(
          '.jdgm-review-search, .jm-search-filter input, input[type="search"]'
        )
      );
    }

    syncJudgeMeSearchInput(query) {
      const input = this.getJudgeMeSearchInput();
      if (!input) return;

      const value = query || '';
      if (input.value === value) return;

      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    resolveNativeSortParams() {
      return {
        by: 'created_at',
        dir: this.sortKey === 'oldest' ? 'asc' : 'desc',
      };
    }

    setWidgetQueryParams() {
      const root = this.getJudgeMeWidgetRoot();
      if (!root) return;

      const { by, dir } = this.resolveNativeSortParams();
      root.dataset.sortBy = by;
      root.dataset.sortDir = dir;

      const jdgm = window.jdgm;
      if (jdgm?.$) {
        const $root = jdgm.$(root);
        $root.data('sort-by', by);
        $root.data('sort-dir', dir);
      }

      this.syncJudgeMeSearchInput(this.searchQuery);
    }

    getPerPage() {
      const configured = Number(this.root.dataset.njrPerPage);
      if (!Number.isNaN(configured) && configured > 0) return configured;
      return DEFAULT_REVIEWS_PER_PAGE;
    }

    buildWidgetRequestParams(page = 1, { includeSearch = true } = {}) {
      const root = this.getJudgeMeWidgetRoot();
      const jdgm = window.jdgm;
      const productId = this.getProductId();
      const { by, dir } = this.resolveNativeSortParams();

      if (includeSearch) {
        this.syncJudgeMeSearchInput(this.searchQuery);
      }

      let params;

      if (jdgm?.$ && root && typeof jdgm.ajaxParamsFor === 'function') {
        const $root = jdgm.$(root);
        if (productId && !$root.data('id')) {
          $root.data('id', productId);
        }
        $root.data('sort-by', by);
        $root.data('sort-dir', dir);
        params = Object.assign({}, jdgm.ajaxParamsFor($root), { page });
      } else {
        params = Object.assign({}, jdgm?.shopParams?.() || {}, {
          product_id: productId,
          sort_by: by,
          sort_dir: dir,
          page,
        });
      }

      params.per_page = this.getPerPage();

      if (includeSearch && this.searchQuery) {
        params.search = this.searchQuery;
        params.keyword = this.searchQuery;
      } else {
        if ('search' in params) params.search = null;
        if ('keyword' in params) params.keyword = null;
      }

      return params;
    }

    resolveFetchUrl(url) {
      const jdgm = window.jdgm;
      const settings = typeof jdgmSettings !== 'undefined' ? jdgmSettings : null;
      if (settings?.enable_ajax_cdn_cache && jdgm?.SPECIAL_CDN_HOST_HTTPS && jdgm?.API_HOST) {
        return url.replace(jdgm.API_HOST, jdgm.SPECIAL_CDN_HOST_HTTPS);
      }
      return url;
    }

    requestWidgetPage(page, { includeSearch = false } = {}) {
      if (!includeSearch) {
        this.syncJudgeMeSearchInput('');
      }

      const ajaxData = Object.assign({}, this.buildWidgetRequestParams(page, { includeSearch }), this.getShopParams());
      const jdgm = window.jdgm;
      const urls = this.getWidgetFetchUrlCandidates().map((url) => this.resolveFetchUrl(url));

      const tryAjax = (fetchUrl) =>
        new Promise((resolve) => {
          if (!jdgm?.$) {
            resolve(null);
            return;
          }
          jdgm.$.ajax({
            url: fetchUrl,
            data: ajaxData,
            success: (response) => resolve(response?.reviews ? response : null),
            error: () => resolve(null),
          });
        });

      const tryFetch = (fetchUrl) => {
        const query = new URLSearchParams();
        Object.entries(ajaxData || {}).forEach(([key, value]) => {
          if (value != null && value !== '') query.set(key, String(value));
        });
        const separator = fetchUrl.includes('?') ? '&' : '?';
        return fetch(`${fetchUrl}${separator}${query.toString()}`, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => (payload?.reviews ? payload : null))
          .catch(() => null);
      };

      const attempts = urls.map((url) => tryAjax(url).then((result) => result || tryFetch(url)));

      return Promise.all(attempts).then((results) => results.find(Boolean) || null);
    }

    waitForReviewListUpdate() {
      return new Promise((resolve) => {
        const list = this.widget?.querySelector('.jdgm-review-list');
        if (!list) {
          resolve();
          return;
        }

        let settleTimer;
        const done = () => {
          observer.disconnect();
          window.clearTimeout(fallbackTimer);
          resolve();
        };

        const observer = new MutationObserver(() => {
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(done, 350);
        });

        observer.observe(list, { childList: true, subtree: true });
        const fallbackTimer = window.setTimeout(done, 2500);
      });
    }

    scrapeReviewsFromDom() {
      const map = new Map();

      this.widget?.querySelectorAll('.jm-review-item').forEach((item) => {
        const uuid = item.getAttribute('review-uuid') || '';
        const base = this.findReviewData(uuid) || { uuid };
        const data = this.normalizeReviewRecord(base, item);

        const id = data.uuid || data.id || uuid;
        if (id) map.set(String(id), data);
      });

      return map;
    }

    async collectReviewsFromDomPaging() {
      const pagination = this.widget?.querySelector('.jm-pagination-controls');
      const widgetData = this.getWidgetData();
      const totalPages = Number(widgetData?.pagination?.total_pages) || 1;

      if (pagination && totalPages > 1) {
        const pageOne = pagination.querySelector(
          '.jm-pagination-controls__button:not(.jm-pagination-controls__button--nav)'
        );
        if (pageOne && Number.parseInt(pageOne.textContent, 10) !== 1) {
          pageOne.click();
          await this.waitForReviewListUpdate();
          this.wrapReviewItems();
        }
      }

      const map = this.scrapeReviewsFromDom();

      if (!pagination || totalPages <= 1) {
        return Array.from(map.values());
      }

      for (let page = 2; page <= totalPages; page += 1) {
        const pageButtons = pagination.querySelectorAll(
          '.jm-pagination-controls__button:not(.jm-pagination-controls__button--nav)'
        );
        const pageButton = Array.from(pageButtons).find(
          (btn) => Number.parseInt(btn.textContent, 10) === page
        );
        const nextButton = pagination.querySelector(
          '.jm-pagination-nav-row .jm-pagination-controls__button--nav:last-child, .jm-pagination-controls__button--nav:last-child'
        );

        if (pageButton) {
          pageButton.click();
        } else if (nextButton) {
          nextButton.click();
        } else {
          break;
        }

        await this.waitForReviewListUpdate();
        this.wrapReviewItems();
        this.scrapeReviewsFromDom().forEach((review, id) => map.set(id, review));
      }

      return Array.from(map.values());
    }

    dedupeReviews(reviews) {
      const seen = new Set();
      return reviews.filter((review) => {
        const id = review.uuid || review.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    mergeReviewCollections(...collections) {
      const byId = new Map();

      collections.flat().forEach((review) => {
        const normalized = this.normalizeReviewRecord(review);
        const id = String(normalized.uuid || normalized.id || '');
        if (!id) return;

        const existing = byId.get(id);
        if (!existing) {
          byId.set(id, normalized);
          return;
        }

        byId.set(id, {
          ...existing,
          ...normalized,
          body: normalized.body || existing.body,
          title: normalized.title || existing.title,
          reviewer_name: normalized.reviewer_name || existing.reviewer_name,
          created_at: normalized.created_at || existing.created_at,
          rating: normalized.rating ?? existing.rating,
        });
      });

      return Array.from(byId.values());
    }

    async collectAllReviews({ force = false } = {}) {
      if (!force && this._allReviewsCache?.length) return this._allReviewsCache;

      let apiReviews = [];
      const page1 = await this.requestWidgetPage(1, { includeSearch: false });

      if (page1?.reviews?.length) {
        apiReviews = [...page1.reviews];
        const totalPages = Number(page1.pagination?.total_pages) || 1;

        for (let page = 2; page <= totalPages; page += 1) {
          const payload = await this.requestWidgetPage(page, { includeSearch: false });
          if (payload?.reviews?.length) apiReviews.push(...payload.reviews);
        }
      }

      const expectedTotal = Number(
        page1?.pagination?.total_count || this.getWidgetData()?.pagination?.total_count || 0
      );

      const needsDomPaging =
        !apiReviews.length || expectedTotal > apiReviews.length || apiReviews.some((r) => !this.extractReviewBody(r));

      let merged = apiReviews;

      if (needsDomPaging) {
        const fromDom = await this.collectReviewsFromDomPaging();
        merged = this.mergeReviewCollections(apiReviews, fromDom);
      } else {
        merged = this.mergeReviewCollections(apiReviews);
      }

      this._allReviewsCache = this.dedupeReviews(merged).map((review) => this.normalizeReviewRecord(review));
      return this._allReviewsCache;
    }

    reviewMatchesQuery(review, query) {
      if (!query) return true;
      const haystack = [
        review.title,
        review.body,
        review.reviewer_name,
        review.product_title,
        review.product_variant_title,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query.toLowerCase());
    }

    reviewMatchesScent(review) {
      if (this.scentFilter === 'all') return true;

      const mapRaw = this.root.dataset.scentMap || '';
      const maps = mapRaw
        .split('|')
        .map((pair) => pair.split(':').map((s) => s.trim()))
        .filter((p) => p.length === 2);

      const haystack = [
        review.product_variant_title,
        review.title,
        review.body,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const entry = maps.find(([slug]) => slug === this.scentFilter);
      if (!entry) return true;

      const keys = entry[1]
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      return keys.some((key) => haystack.includes(key));
    }

    getReviewTimestampFromRecord(review) {
      if (!review) return 0;

      const candidates = [
        review.created_at,
        review.created_at_iso,
        review.user_friendly_created_at,
      ];

      for (const value of candidates) {
        const time = new Date(value).getTime();
        if (!Number.isNaN(time)) return time;
      }

      return 0;
    }

    getSortedReviews(reviews) {
      const list = [...reviews];
      list.sort((a, b) => {
        const ta = this.getReviewTimestampFromRecord(a);
        const tb = this.getReviewTimestampFromRecord(b);
        return this.sortKey === 'oldest' ? ta - tb : tb - ta;
      });
      return list;
    }

    getFilteredDisplayReviews() {
      const query = this.searchQuery.trim();
      const source = this._allReviewsCache || [];
      return this.getSortedReviews(
        source.filter(
          (review) => this.reviewMatchesQuery(review, query) && this.reviewMatchesScent(review)
        )
      );
    }

    bootstrapCustomList() {
      this._listRequestId += 1;
      const requestId = this._listRequestId;

      this.collectAllReviews()
        .then((all) => {
          if (requestId !== this._listRequestId || !all?.length) return;
          if (this.searchQuery.trim()) return;
          this.renderCustomResultsPage(1);
        })
        .catch(() => {
          /* keep native widget list on bootstrap failure */
        });
    }

    showSearchLoading(isLoading) {
      this.els.search?.closest('.njr__search-wrap')?.classList.toggle('njr__search-wrap--loading', isLoading);
    }

    updateSearchEmptyState(isEmpty) {
      let el = this.root.querySelector('[data-njr-search-empty]');
      if (!el) {
        el = document.createElement('p');
        el.className = 'njr__search-empty';
        el.dataset.njrSearchEmpty = '';
        this.els.widgetSlot?.insertAdjacentElement('afterend', el);
      }
      el.hidden = !isEmpty;
      el.textContent = isEmpty ? 'No reviews match your search.' : '';
    }

    scrollToReviewsTop() {
      const target =
        this.widget?.querySelector('.jdgm-review-list') ||
        this.root.querySelector('.njr__main') ||
        this.root;

      const styles = getComputedStyle(document.documentElement);
      const headerOffset =
        parseInt(styles.getPropertyValue('--header-height'), 10) ||
        parseInt(styles.getPropertyValue('--nonomic-header-height'), 10) ||
        0;

      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset - 24;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    renderCustomResultsPage(page = 1, { scrollToTop = false } = {}) {
      this.syncJudgeMeSearchInput(this.searchQuery);

      const perPage = this.getPerPage();
      const filtered = this.getFilteredDisplayReviews();
      const totalPages = Math.max(1, Math.ceil(filtered.length / perPage) || 1);
      const safePage = Math.min(Math.max(1, page), totalPages);
      const previousPage = this._customListPage || 1;
      const slice = filtered.slice((safePage - 1) * perPage, safePage * perPage);

      this._customListActive = true;
      this._customListPage = safePage;

      const payload = {
        reviews: slice,
        pagination: {
          current_page: safePage,
          total_pages: totalPages,
          total_count: filtered.length,
          per_page: perPage,
        },
      };

      this.mergeWidgetReviewPayload(payload);
      this.renderReviewsList(slice);
      this.updateSearchEmptyState(Boolean(this.searchQuery.trim()) && filtered.length === 0);
      this.restylePagination();

      if (scrollToTop && safePage !== previousPage) {
        window.requestAnimationFrame(() => this.scrollToReviewsTop());
      }
    }

    renderReviewsList(reviews) {
      const list = this.widget?.querySelector('.jdgm-review-list');
      if (!list) return 0;

      this._searchRendering = true;
      list.innerHTML = '';

      reviews.forEach((review, index) => {
        const normalized = this.normalizeReviewRecord(review);
        const item = document.createElement('div');
        item.className = 'jm-review-item';
        item.setAttribute('review-uuid', normalized.uuid || normalized.id || '');
        list.appendChild(item);
        this.buildFigmaReviewCard(item, normalized);
        item.dataset.njrScent = this.resolveScentSlug(normalized, item);
        item.dataset.njrSearchText = this.buildSearchText(item, normalized);

        if (index < reviews.length - 1) {
          const divider = document.createElement('hr');
          divider.className = 'njr__review-divider';
          divider.setAttribute('aria-hidden', 'true');
          item.after(divider);
        }
      });

      this._searchRendering = false;
      return reviews.length;
    }

    async restoreViaPaginationClick() {
      const pagination = this.widget?.querySelector('.jm-pagination-controls');
      const pageOne = pagination?.querySelector(
        '.jm-pagination-controls__button:not(.jm-pagination-controls__button--nav)'
      );

      if (!pageOne) return false;

      pageOne.click();
      await this.waitForReviewListUpdate();
      this.wrapReviewItems();
      this.applyClientFilters();
      return (this.widget?.querySelectorAll('.jm-review-item').length || 0) > 0;
    }

    async restoreDefaultReviews() {
      this._listRequestId += 1;
      const requestId = this._listRequestId;
      window.clearTimeout(this.searchDebounceTimer);

      this.searchQuery = '';
      this.updateSearchEmptyState(false);
      this.syncJudgeMeSearchInput('');
      this.showSearchLoading(true);

      try {
        const all = await this.collectAllReviews();
        if (requestId !== this._listRequestId) return;

        if (all?.length) {
          this.renderCustomResultsPage(1);
          this.populateHeader();
          this.restylePagination();
          return;
        }

        this._customListActive = false;
        this._customListPage = 1;
        await this.restoreViaPaginationClick();
        this.populateHeader();
        this.restylePagination();
      } finally {
        if (requestId === this._listRequestId) this.showSearchLoading(false);
        this._searchRendering = false;
      }
    }

    clearSearch() {
      if (this.els.search) this.els.search.value = '';
      this.restoreDefaultReviews();
    }

    mergeWidgetReviewPayload(payload) {
      if (!payload) return;
      const id = this.getProductId();
      if (!id) return;

      window.jdgm = window.jdgm || {};
      window.jdgm.data = window.jdgm.data || {};
      window.jdgm.data.reviewWidget = window.jdgm.data.reviewWidget || {};
      window.jdgm.data.reviewWidget[id] = Object.assign(
        {},
        window.jdgm.data.reviewWidget[id] || {},
        payload
      );
    }

    finishWidgetRefresh() {
      this._widgetFetching = false;
      window.requestAnimationFrame(() => {
        this.populateHeader();
        this.wrapReviewItems();
        if (!this._customListActive) {
          this.applyClientFilters();
        }
        this.restylePagination();
      });
    }

    handleWidgetFetchSuccess(response, successCallback, $root) {
      this.mergeWidgetReviewPayload(response);
      if (typeof successCallback === 'function' && $root) {
        successCallback(response, $root);
      } else {
        this.applySearchResultsFromResponse(response);
      }
      this.finishWidgetRefresh();
    }

    applySearchResultsFromResponse(response) {
      const items = this.widget?.querySelectorAll('.jm-review-item');
      if (!items?.length) return;

      if (!this.searchQuery) {
        items.forEach((item) => item.classList.remove('njr--hidden'));
        return;
      }

      const reviews = response?.reviews;
      if (!Array.isArray(reviews)) return;

      const ids = new Set(
        reviews.map((review) => String(review.uuid || review.id || '')).filter(Boolean)
      );

      items.forEach((item) => {
        const uuid = item.getAttribute('review-uuid') || '';
        item.classList.toggle('njr--hidden', ids.size > 0 && !ids.has(uuid));
      });
    }

    triggerJudgeMeNativeSearch() {
      this.syncJudgeMeSearchInput(this.searchQuery);

      const input = this.getJudgeMeSearchInput();
      if (!input) return false;

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

      const form = input.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }

      return true;
    }

    fetchWidgetWithParams(fetchUrl, ajaxData, successCallback, $root) {
      const query = new URLSearchParams();
      Object.entries(ajaxData || {}).forEach(([key, value]) => {
        if (value != null && value !== '') query.set(key, String(value));
      });

      const separator = fetchUrl.includes('?') ? '&' : '?';
      return fetch(`${fetchUrl}${separator}${query.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(response)))
        .then((payload) => {
          this.handleWidgetFetchSuccess(payload, successCallback, $root);
          return true;
        })
        .catch(() => false);
    }

    refetchWidget({ page = 1 } = {}) {
      const jdgm = window.jdgm;
      const root = this.getJudgeMeWidgetRoot();
      const fetchUrl = this.getWidgetFetchUrl();
      if (!root || !fetchUrl) return false;
      const resolvedUrl = this.resolveFetchUrl(fetchUrl);

      this.setWidgetQueryParams();
      const ajaxData = this.buildWidgetRequestParams(page);

      this._widgetFetching = true;
      jdgm?.triggerEvent?.('beforeFetchingReviews');

      if (jdgm?.$) {
        const $root = jdgm.$(root);
        const successCallback = $root.data('success-callback');

        jdgm.$.ajax({
          url: resolvedUrl,
          data: ajaxData,
          success: (response) => this.handleWidgetFetchSuccess(response, successCallback, $root),
          error: () => {
            this.fetchWidgetWithParams(resolvedUrl, ajaxData, successCallback, $root).finally(() => {
              if (this._widgetFetching) {
                this.applyClientFilters();
                this.finishWidgetRefresh();
              }
            });
          },
        });
        return true;
      }

      this.fetchWidgetWithParams(resolvedUrl, ajaxData).finally(() => {
        if (this._widgetFetching) this.finishWidgetRefresh();
      });
      return true;
    }

    bindWidgetPaginationPersistence() {
      if (this._paginationBound) return;
      this._paginationBound = true;

      this.els.widgetSlot?.addEventListener(
        'click',
        (event) => {
          const nav = event.target.closest('.jm-pagination-controls__button--nav');
          const pageBtn = event.target.closest(
            '.jm-pagination-controls__button:not(.jm-pagination-controls__button--nav)'
          );

          if (!nav && !pageBtn) return;

          if (this._customListActive) {
            event.preventDefault();
            event.stopPropagation();

            if (pageBtn) {
              const page = Number.parseInt(pageBtn.textContent, 10);
              if (!Number.isNaN(page)) this.renderCustomResultsPage(page, { scrollToTop: true });
              return;
            }

            if (nav.classList.contains('jm-button--disabled') || nav.disabled) return;

            const role = nav.dataset.njrNav;
            const current = this._customListPage || 1;
            let targetPage = current;

            if (role === 'prev') {
              targetPage = current - 1;
            } else if (role === 'next') {
              targetPage = current + 1;
            } else {
              const isNext = nav.textContent?.includes('Next');
              targetPage = current + (isNext ? 1 : -1);
            }

            this.renderCustomResultsPage(targetPage, { scrollToTop: true });
            return;
          }

          this.setWidgetQueryParams();
        },
        true
      );
    }

    applySearch() {
      const query = this.searchQuery.trim();

      if (!query) {
        if (this.els.search) this.els.search.value = '';
        this.restoreDefaultReviews();
        return;
      }

      this._listRequestId += 1;
      const requestId = this._listRequestId;
      this.showSearchLoading(true);

      this.collectAllReviews()
        .then(() => {
          if (requestId !== this._listRequestId) return;
          this.renderCustomResultsPage(1);
        })
        .catch(() => {
          if (requestId !== this._listRequestId) return;
          this.applyClientFilters();
        })
        .finally(() => {
          if (requestId === this._listRequestId) this.showSearchLoading(false);
        });
    }

    applyScentFilter() {
      if (this._customListActive || this.searchQuery.trim() || this._allReviewsCache?.length) {
        const render = () => this.renderCustomResultsPage(1);
        if (this._allReviewsCache?.length) {
          render();
          return;
        }

        this._listRequestId += 1;
        const requestId = this._listRequestId;
        this.collectAllReviews().then(() => {
          if (requestId !== this._listRequestId) return;
          render();
        });
        return;
      }

      this.applyClientFilters();
    }

    getReviewTimestamp(item) {
      const uuid = item.getAttribute('review-uuid') || '';
      const data = this.findReviewData(uuid);
      if (data?.created_at) {
        const time = new Date(data.created_at).getTime();
        if (!Number.isNaN(time)) return time;
      }

      const dateText = item.querySelector('.review-card__date')?.textContent?.trim();
      if (dateText) {
        const time = new Date(dateText).getTime();
        if (!Number.isNaN(time)) return time;
      }

      return 0;
    }

    sortReviewsInDom() {
      const list = this.widget?.querySelector('.jdgm-review-list');
      if (!list) return;

      const items = Array.from(list.querySelectorAll(':scope > .jm-review-item'));
      if (items.length < 2) return;

      const descending = this.sortKey !== 'oldest';
      const sorted = items
        .map((item) => ({ item, time: this.getReviewTimestamp(item) }))
        .sort((a, b) => (descending ? b.time - a.time : a.time - b.time))
        .map((entry) => entry.item);

      const orderChanged = sorted.some((item, index) => item !== items[index]);
      if (!orderChanged) return;

      this._applyingSort = true;
      sorted.forEach((item) => list.appendChild(item));
      this.syncReviewDividers();
      this._applyingSort = false;
    }

    applySort() {
      if (this._customListActive && this._allReviewsCache?.length) {
        this.renderCustomResultsPage(this._customListPage || 1);
        return;
      }

      this._listRequestId += 1;
      const requestId = this._listRequestId;
      this.showSearchLoading(true);

      this.collectAllReviews()
        .then(() => {
          if (requestId !== this._listRequestId) return;
          this.renderCustomResultsPage(1);
        })
        .catch(() => {
          if (requestId !== this._listRequestId) return;
          this.setWidgetQueryParams();
          this.sortReviewsInDom();
        })
        .finally(() => {
          if (requestId === this._listRequestId) this.showSearchLoading(false);
        });
    }

    applyClientFilters() {
      const items = this.widget?.querySelectorAll('.jm-review-item');
      const query = this.searchQuery.trim().toLowerCase();

      items?.forEach((item) => {
        const scent = item.dataset.njrScent || 'all';
        const text = item.dataset.njrSearchText || item.textContent.toLowerCase();
        const scentOk = this.scentFilter === 'all' || scent === this.scentFilter;
        const searchOk = !query || text.includes(query);
        const hidden = !(scentOk && searchOk);
        item.classList.toggle('njr--hidden', hidden);
        const divider = item.nextElementSibling;
        if (divider?.classList.contains('njr__review-divider')) {
          divider.style.display = hidden ? 'none' : '';
        }
      });
    }

    refreshReviews() {
      this.wrapReviewItems();
      this.applyClientFilters();
      this.restylePagination();
    }

    observeListChanges() {
      const target = this.widget?.querySelector('.jdgm-review-list') || this.widget;
      if (!target) return;

      if (this.listMo) this.listMo.disconnect();

      this.listMo = new MutationObserver(() => {
        if (this._applyingSort || this._widgetFetching || this._searchRendering) return;
        window.requestAnimationFrame(() => {
          if (this._applyingSort || this._widgetFetching || this._searchRendering) return;
          if (this._customListActive) {
            this.renderCustomResultsPage(this._customListPage || 1);
            return;
          }
          this.wrapReviewItems();
          this.applyClientFilters();
          this.restylePagination();
        });
      });
      this.listMo.observe(target, { childList: true, subtree: true });
    }

    restylePagination() {
      const pagination = this.widget?.querySelector('.jm-pagination-controls');
      if (!pagination) return;

      const data = this.getWidgetData();
      const pag = data?.pagination;
      const cluster = pagination.querySelector('.jm-cluster');
      if (!cluster) return;

      const totalPages = Number(pag?.total_pages) || 1;
      pagination.hidden = totalPages <= 1;

      if (pag) {
        const label = `Page ${pag.current_page} of ${pag.total_pages}`;
        cluster.setAttribute('data-njr-page-label', label);
      }

      const { prev, next } = this.ensurePaginationNavRow(cluster, pag);
      if (!prev || !next) return;

      prev.dataset.njrNav = 'prev';
      next.dataset.njrNav = 'next';

      if (!prev.dataset.njrLabeled) {
        prev.dataset.njrLabeled = 'true';
        prev.setAttribute('aria-label', 'Previous page');
        prev.textContent = '\u2190 Previous';
      }
      if (!next.dataset.njrLabeled) {
        next.dataset.njrLabeled = 'true';
        next.setAttribute('aria-label', 'Next page');
        next.textContent = 'Next \u2192';
      }

      this.syncPaginationNavState(prev, next, pag);
    }

    ensurePaginationNavRow(cluster, pag) {
      let allNav = Array.from(cluster.querySelectorAll('.jm-pagination-controls__button--nav'));

      if (!allNav.length && pag && Number(pag.total_pages) > 1) {
        let row = cluster.querySelector('.jm-pagination-nav-row');
        if (!row) {
          row = document.createElement('div');
          row.className = 'jm-pagination-nav-row';
          cluster.appendChild(row);
        }

        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'jm-pagination-controls__button jm-pagination-controls__button--nav';
        prev.dataset.njrNav = 'prev';

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'jm-pagination-controls__button jm-pagination-controls__button--nav';
        next.dataset.njrNav = 'next';

        row.appendChild(prev);
        row.appendChild(next);
        allNav = [prev, next];
      }

      if (!allNav.length) return { prev: null, next: null };

      let prev = allNav.find((btn) => btn.dataset.njrNav === 'prev') || null;
      let next = allNav.find((btn) => btn.dataset.njrNav === 'next') || null;

      if (!prev || !next) {
        prev =
          allNav.find((btn) =>
            /prev|previous|back|left/i.test(btn.getAttribute('aria-label') || '')
          ) || null;
        next =
          allNav.find((btn) =>
            /next|forward|right/i.test(btn.getAttribute('aria-label') || '')
          ) || null;
      }

      if (!prev || !next) {
        prev = allNav[0];
        next = allNav.length > 1 ? allNav[allNav.length - 1] : null;
        if (prev === next && allNav.length > 1) {
          prev = allNav[0];
          next = allNav[1];
        }
      }

      let row = cluster.querySelector('.jm-pagination-nav-row');
      if (!row) {
        row = document.createElement('div');
        row.className = 'jm-pagination-nav-row';
        cluster.appendChild(row);
      }

      if (prev && prev.parentElement !== row) row.appendChild(prev);
      if (next && next.parentElement !== row) row.appendChild(next);

      if (prev && next && prev.nextElementSibling !== next) {
        row.insertBefore(prev, next);
      }

      return { prev, next };
    }

    syncPaginationNavState(prev, next, pag) {
      if (!prev || !next || !pag) return;

      const current = Number(pag.current_page) || 1;
      const total = Number(pag.total_pages) || 1;

      const setBtn = (btn, disabled) => {
        btn.classList.toggle('jm-button--disabled', disabled);
        btn.toggleAttribute('disabled', disabled);
        btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      };

      setBtn(prev, current <= 1);
      setBtn(next, current >= total);
    }
  }

  function getReviewsSection() {
    const root = document.getElementById(REVIEWS_ANCHOR_ID);
    return root?.matches(SECTION_SELECTOR) ? root : null;
  }

  function scrollToReviewsFromPdp({ openWrite = false } = {}) {
    const root = getReviewsSection();
    if (!root) return false;

    const instance = njrInstances.get(root);
    if (instance) {
      instance.scrollToReviewsTop();
      if (openWrite) {
        const openForm = () => instance.openWriteReview();
        if (instance.enhanced) {
          window.setTimeout(openForm, 400);
        } else {
          window.setTimeout(openForm, 1200);
        }
      }
      return true;
    }

    const styles = getComputedStyle(document.documentElement);
    const headerOffset =
      parseInt(styles.getPropertyValue('--header-height'), 10) ||
      parseInt(styles.getPropertyValue('--nonomic-header-height'), 10) ||
      0;
    const top = root.getBoundingClientRect().top + window.scrollY - headerOffset - 24;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    return true;
  }

  function handlePdpReviewsLink(event) {
    const link = event.target.closest('[data-nonomic-scroll-reviews]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    if (!href.includes(REVIEWS_ANCHOR_ID)) return;

    event.preventDefault();
    scrollToReviewsFromPdp({ openWrite: link.hasAttribute('data-nonomic-open-write-review') });
    history.replaceState(null, '', href.split('?')[0]);
  }

  function handleReviewsHashOnLoad() {
    const hash = window.location.hash;
    if (hash !== `#${REVIEWS_ANCHOR_ID}` && hash !== `#${REVIEWS_ANCHOR_ID}-write`) return;

    const openWrite = hash.endsWith('-write');
    let attempts = 0;

    const tryScroll = () => {
      const root = getReviewsSection();
      const instance = root && njrInstances.get(root);

      if (instance?.enhanced || (!openWrite && instance)) {
        scrollToReviewsFromPdp({ openWrite });
        return;
      }

      attempts += 1;
      if (attempts < 50) {
        window.setTimeout(tryScroll, 200);
        return;
      }

      scrollToReviewsFromPdp({ openWrite });
    };

    tryScroll();
  }

  function initSection(root) {
    if (root.dataset.njrInitialized === 'true') return;
    root.dataset.njrInitialized = 'true';
    njrInstances.set(root, new NonomicJudgeMeReviews(root));
  }

  function initAll(container = document) {
    container.querySelectorAll(SECTION_SELECTOR).forEach(initSection);
  }

  function initPdpReviewLinks() {
    document.addEventListener('click', handlePdpReviewsLink);
    handleReviewsHashOnLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAll();
      initPdpReviewLinks();
    });
  } else {
    initAll();
    initPdpReviewLinks();
  }

  document.addEventListener('shopify:section:load', (event) => {
    const section = event.target.querySelector?.(SECTION_SELECTOR) || event.target.closest?.(SECTION_SELECTOR);
    if (section) {
      section.dataset.njrInitialized = 'false';
      initSection(section);
    } else {
      initAll(event.target);
    }
  });
})();
