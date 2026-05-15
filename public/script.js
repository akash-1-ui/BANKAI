(function() {
    'use strict';

    const STORAGE_KEY = 'alignmentPreviewDataV3';
    const LEGACY_STORAGE_KEY = 'alignmentPreviewDataV2';
    const SOURCE_TEXT_KEY = 'alignmentPreviewSourceV3';
    const SETTINGS_KEY = 'alignmentPreviewSettingsV8';
    const PAYMENT_STATUS_KEY = 'paymentStatus';
    const USER_PIN_KEY = 'userPin';
    const USER_PASSWORD_KEY = 'userPassword';
    const NUMBER_ONLY_PATTERN = /^>?\d+(?:\.\d+)?$/;
    const INLINE_NUMBER_PATTERN = /^(>?\d+(?:\.\d+)?)[\).\-\s]+(.+)$/;
    const DEFAULT_PAGE_SETTINGS = Object.freeze({
        fontSize: 7,
        lineHeight: 1.2,
        centerFill: false
    });
    const BASE_FONT_SIZE = 7;
    const A4_WIDTH_PX = 794;
    const A4_HEIGHT_PX = 1123;
    
    const PRINT_PRESETS = Object.freeze({
        balanced: { label: 'Balanced', fontSize: 7, lineHeight: 1.2 },
        readable: { label: 'Readable', fontSize: 7.35, lineHeight: 1.3 },
        compact: { label: 'Compact', fontSize: 6.3, lineHeight: 1.15 },
        maxFit: { label: 'Max Fit', fontSize: 5.6, lineHeight: 1.1 }
    });
    const BLOCK_STYLE = Object.freeze({
        BODY: 'body',
        HEADING: 'heading'
    });
    const LIVE_PREVIEW_DELAY = 50;
    const NUM_COLUMNS = 3;
    const NUM_ROWS = 3;
    const COLUMN_FIT_BUFFER = 1;

    const chatInput = document.getElementById('chatInput');
    const parsePreviewBtn = document.getElementById('parsePreview');
    const clearAllBtn = document.getElementById('clearAll');
    const previewContent = document.getElementById('previewContent');
    const previewViewport = document.getElementById('previewViewport');
    const previewPrevBtn = document.getElementById('previewPrev');
    const previewNextBtn = document.getElementById('previewNext');
    const applyAllPagesBtn = document.getElementById('applyAllPages');
    const pageNumberInput = document.getElementById('pageNumberInput');
    const fontSizeSlider = document.getElementById('fontSize');
    const lineHeightSlider = document.getElementById('lineHeight');
    const centerFillToggle = document.getElementById('centerFill');
    const editModeToggle = document.getElementById('editMode');
    const fontSizeValue = document.getElementById('fontSizeValue');
    const lineHeightValue = document.getElementById('lineHeightValue');
    const centerFillValue = document.getElementById('centerFillValue');
    const editModeValue = document.getElementById('editModeValue');
    const pageScopeValue = document.getElementById('pageScopeValue');
    const pageScopeHint = document.getElementById('pageScopeHint');
    const pageCountMeta = document.getElementById('pageCountMeta');
    const pageTargetMeta = document.getElementById('pageTargetMeta');
    const exportBtn = document.getElementById('exportPDF');
    const twoPageViewBtn = document.getElementById('twoPageView');
    const accountMenuBtn = document.getElementById('accountMenuBtn');
    const accountMenu = document.getElementById('accountMenu');
    const logoutBtn = document.getElementById('logoutBtn');
    const userPinBadge = document.getElementById('userPinBadge');


    let previewData = [];
    let renderedPages = [];
    let globalPageSettings = { ...DEFAULT_PAGE_SETTINGS };
    let pageOverrides = {};
    let selectedScope = { mode: 'page', page: 1 };
    let inputPreviewTimeoutId;
    let resizeTimeoutId;
    let currentPageIndex = 0;
    let editMode = false;
    let twoPageView = false;


    function normalizeLine(line) {
        return String(line || '').replace(/\u00A0/g, ' ').replace(/\t/g, '    ').trim();
    }

    function getPremiumApiUrl(endpoint) {
        const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        const isSeparateLocalFrontend = isLocalHost && window.location.port && window.location.port !== '3000';
        const baseUrl = isSeparateLocalFrontend ? 'http://localhost:3000' : window.location.origin;

        return `${baseUrl}${endpoint}`;
    }

    async function verifyStoredAccount() {
        const userPin = localStorage.getItem(USER_PIN_KEY);
        const userPassword = localStorage.getItem(USER_PASSWORD_KEY);

        if (!userPin || !userPassword) {
            window.location.href = 'premium.html';
            return null;
        }

        try {
            const response = await fetch(getPremiumApiUrl('/api/premium/login'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pin: userPin,
                    password: userPassword
                })
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Account verification failed.');
            }

            return data.pin || userPin;
        } catch (error) {
            localStorage.removeItem(USER_PIN_KEY);
            localStorage.removeItem(USER_PASSWORD_KEY);
            localStorage.removeItem(PAYMENT_STATUS_KEY);
            window.location.href = 'premium.html';
            return null;
        }
    }

    function parseSourceText(text) {
        const rawLines = text.split(/\r?\n/);
        const result = [];
        let paragraphLines = [];
        let numberedBlock = null;

        function pushBlock(marker, lines) {
            const normalizedText = lines.map(normalizeLine).filter(Boolean).join(' ').trim();
            if (!marker && !normalizedText) return;
            result.push({ marker, text: normalizedText });
        }

        rawLines.forEach(line => {
            const normalized = normalizeLine(line);
            if (!normalized) {
                if (paragraphLines.length) pushBlock('', paragraphLines);
                if (numberedBlock) pushBlock(numberedBlock.marker, numberedBlock.lines);
                paragraphLines = [];
                numberedBlock = null;
                return;
            }

            const inlineMatch = normalized.match(INLINE_NUMBER_PATTERN);
            if (inlineMatch) {
                if (paragraphLines.length) pushBlock('', paragraphLines);
                numberedBlock = { marker: inlineMatch[1], lines: [inlineMatch[2]] };
                paragraphLines = [];
                return;
            }

            if (NUMBER_ONLY_PATTERN.test(normalized)) {
                if (paragraphLines.length) pushBlock('', paragraphLines);
                numberedBlock = { marker: normalized, lines: [] };
                paragraphLines = [];
                return;
            }

            if (numberedBlock) {
                numberedBlock.lines.push(normalized);
            } else {
                paragraphLines.push(normalized);
            }
        });

        if (paragraphLines.length) pushBlock('', paragraphLines);
        if (numberedBlock) pushBlock(numberedBlock.marker, numberedBlock.lines);

        return result.filter(item => item.marker || item.text);
    }

    function getPageSettings(pageNumber) {
        return {
            ...globalPageSettings,
            ...(pageOverrides[pageNumber] || {}),
            pageWidth: A4_WIDTH_PX,
            pageHeight: A4_HEIGHT_PX
        };
    }

    function createPageShell(pageNumber, settings) {
        const frame = document.createElement('article');
        frame.className = 'preview-page-frame';
        frame.style.width = '794px';
        frame.style.height = '1123px';

        const header = document.createElement('div');
        header.className = 'preview-page-header';
        header.innerHTML = `<span class="preview-page-badge">Page ${pageNumber}</span>`;
        frame.appendChild(header);

        const page = document.createElement('section');
        page.className = 'preview-page';
        page.dataset.pageNumber = String(pageNumber);

        const body = document.createElement('div');
        body.className = 'preview-page-body';
        body.classList.toggle('is-center-fill', Boolean(settings.centerFill));
        body.style.lineHeight = String(settings.lineHeight);
        body.style.fontSize = `${settings.fontSize}px`;

        const columns = [];
        for (let i = 0; i < 3; i++) {
            const col = document.createElement('div');
            col.className = 'preview-page-row';
            col.dataset.colNumber = String(i + 1);
            col.style.fontSize = `${settings.fontSize}px`;
            col.style.lineHeight = String(settings.lineHeight);
            body.appendChild(col);
            columns.push(col);
        }

        page.appendChild(body);
        frame.appendChild(page);

        return { frame, page, body, columns };
    }

    function createPreviewItemElement(item, editContext = null) {
        const article = document.createElement('article');
        article.className = `preview-item${item.marker ? '' : ' no-marker'}${item.continued ? ' continued' : ''}`;
        article.classList.toggle('is-editable', Boolean(editContext));

        if (item.marker) {
            const marker = document.createElement('span');
            marker.className = 'preview-item-marker';
            marker.textContent = item.marker;

            const text = document.createElement('span');
            text.className = 'preview-item-text';
            text.textContent = item.text;

            article.append(marker, text);
        } else {
            const text = document.createElement('p');
            text.className = 'preview-item-text';
            text.textContent = item.text;
            article.appendChild(text);
        }

        if (editContext) {
            const textElement = article.querySelector('.preview-item-text');
            textElement.contentEditable = 'true';
            textElement.spellcheck = false;
            textElement.addEventListener('blur', () => {
                const nextText = normalizeLine(textElement.textContent);
                renderedPages[editContext.pageIndex].columns[editContext.colIndex][editContext.itemIndex].text = nextText;
                textElement.textContent = nextText;
            });

            const deleteButton = document.createElement('button');
            deleteButton.className = 'item-edit-button item-edit-button--delete';
            deleteButton.type = 'button';
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => {
                renderedPages[editContext.pageIndex].columns[editContext.colIndex].splice(editContext.itemIndex, 1);
                displayCurrentPage();
            });
            article.appendChild(deleteButton);
        }

        return article;
    }

    function addItemToColumn(pageIndex, colIndex) {
        const page = renderedPages[pageIndex];
        if (!page) return;

        page.columns[colIndex].push({
            marker: '',
            text: 'New text',
            continued: false
        });
        displayCurrentPage();
    }

    function getColumnContentHeight(column) {
        const items = Array.from(column.children);
        if (!items.length) return 0;

        const gap = parseFloat(getComputedStyle(column).rowGap) || 0;
        return items.reduce((total, item) => total + item.offsetHeight, 0) + gap * (items.length - 1);
    }

    function fitsInColumn(column, availableHeight, item) {
        const testArticle = createPreviewItemElement(item);
        column.appendChild(testArticle);
        const fits = getColumnContentHeight(column) <= availableHeight - COLUMN_FIT_BUFFER;
        testArticle.remove();
        return fits;
    }

    function splitItemForColumn(item, column, availableHeight) {
        const words = item.text.trim().split(/\s+/).filter(Boolean);
        if (words.length < 2) return null;

        let low = 1;
        let high = words.length - 1;
        let best = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const candidate = {
                ...item,
                text: words.slice(0, mid).join(' ')
            };

            if (fitsInColumn(column, availableHeight, candidate)) {
                best = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        if (best === 0) return null;

        return {
            head: {
                ...item,
                text: words.slice(0, best).join(' ')
            },
            tail: {
                marker: '',
                text: words.slice(best).join(' '),
                continued: true
            }
        };
    }

    function paginatePreviewData(items) {
        if (!items.length) return [];

        const measurementHost = document.createElement('div');
        measurementHost.className = 'preview-measurements';
        measurementHost.style.position = 'absolute';
        measurementHost.style.left = '-99999px';
        measurementHost.style.top = '0';
        measurementHost.style.visibility = 'hidden';
        measurementHost.style.pointerEvents = 'none';
        measurementHost.style.width = '794px';
        document.body.appendChild(measurementHost);

        const pages = [];
        let contentQueue = [...items].filter(item => item.marker || item.text);
        let pageNumber = 1;


        while (contentQueue.length > 0) {
            const settings = getPageSettings(pageNumber);
            const shell = createPageShell(pageNumber, settings);

            measurementHost.appendChild(shell.frame);
            shell.frame.offsetHeight;
            shell.page.offsetHeight;
            shell.body.offsetHeight;

            const pageColumns = [[], [], []];
            let itemsPlaced = 0;

            for (let colIndex = 0; colIndex < NUM_COLUMNS; colIndex++) {
                const column = shell.columns[colIndex];
                const availableHeight = column.clientHeight || shell.body.clientHeight;

                while (contentQueue.length > 0) {
                    const current = contentQueue[0];

                    if (fitsInColumn(column, availableHeight, current)) {
                        column.appendChild(createPreviewItemElement(current));
                        pageColumns[colIndex].push(current);
                        contentQueue.shift();
                        itemsPlaced++;
                        continue;
                    }

                    const split = splitItemForColumn(current, column, availableHeight);
                    if (split) {
                        column.appendChild(createPreviewItemElement(split.head));
                        pageColumns[colIndex].push(split.head);
                        contentQueue[0] = split.tail;
                        itemsPlaced++;
                    }

                    break;
                }
            }

            // Clean up measurement items
            shell.columns.forEach(col => {
                while (col.firstChild) {
                    col.removeChild(col.firstChild);
                }
            });
            
            measurementHost.removeChild(shell.frame);
            pages.push({ number: pageNumber, settings, columns: pageColumns });
            pageNumber++;
            
            // Safety check: if no items were placed, force place at least one to prevent infinite loop
            if (itemsPlaced === 0 && contentQueue.length > 0) {
                pageColumns[0].push(contentQueue.shift());
                pages[pages.length - 1].columns = pageColumns;
            }
        }

        measurementHost.remove();
        return pages;
    }

    function renderPreview() {
        previewData = parseSourceText(chatInput.value);
        renderedPages = paginatePreviewData(previewData);
        currentPageIndex = 0;
        displayCurrentPage();
        pageCountMeta.textContent = `Pages: ${renderedPages.length}`;
    }

    function renderPageFrame(pageIndex) {
        const pageData = renderedPages[pageIndex];
        if (!pageData) return null;

        const settings = getPageSettings(pageData.number);
        const shell = createPageShell(pageData.number, settings);
        shell.frame.classList.toggle('is-edit-mode', editMode);

        pageData.columns.forEach((colItems, colIndex) => {
            colItems.forEach((item, itemIndex) => {
                const context = editMode ? {
                    pageIndex,
                    colIndex,
                    itemIndex
                } : null;
                shell.columns[colIndex].appendChild(createPreviewItemElement(item, context));
            });

            if (editMode) {
                const addButton = document.createElement('button');
                addButton.className = 'column-add-button';
                addButton.type = 'button';
                addButton.textContent = 'Add';
                addButton.addEventListener('click', () => addItemToColumn(pageIndex, colIndex));
                shell.columns[colIndex].appendChild(addButton);
            }
        });

        return shell.frame;
    }

    function getDisplayScale(pageCount) {
        const gap = pageCount > 1 ? 18 : 0;
        const availableWidth = Math.max(220, previewViewport.clientWidth - 12);
        const pairWidth = A4_WIDTH_PX * pageCount + gap;
        return Math.min(1, availableWidth / pairWidth);
    }

    function appendPageFrame(frame, scale) {
        if (scale >= 0.999) {
            previewContent.appendChild(frame);
            return;
        }

        const slot = document.createElement('div');
        slot.className = 'preview-page-slot';
        slot.style.width = `${A4_WIDTH_PX * scale}px`;
        slot.style.height = `${A4_HEIGHT_PX * scale}px`;
        frame.style.transform = `scale(${scale})`;
        slot.appendChild(frame);
        previewContent.appendChild(slot);
    }

    function displayCurrentPage() {
        previewContent.innerHTML = '';
        previewContent.classList.toggle('is-dual-page-view', twoPageView);

        if (renderedPages.length && currentPageIndex < renderedPages.length) {
            const startIndex = twoPageView ? Math.floor(currentPageIndex / 2) * 2 : currentPageIndex;
            currentPageIndex = startIndex;
            const visibleIndexes = twoPageView ? [startIndex, startIndex + 1] : [startIndex];
            const visibleFrames = visibleIndexes
                .map(pageIndex => renderPageFrame(pageIndex))
                .filter(Boolean);
            const displayScale = getDisplayScale(visibleFrames.length);

            visibleFrames.forEach(frame => appendPageFrame(frame, displayScale));

            const firstPage = renderedPages[startIndex];
            const secondPage = renderedPages[startIndex + 1];
            if (twoPageView && secondPage) {
                pageTargetMeta.textContent = `Pages ${firstPage.number}-${secondPage.number} of ${renderedPages.length}`;
            } else {
                const pageData = renderedPages[startIndex];
                pageTargetMeta.textContent = `Page ${pageData.number} of ${renderedPages.length}`;
            }

            previewPrevBtn.disabled = startIndex === 0;
            previewNextBtn.disabled = twoPageView
                ? startIndex + 2 >= renderedPages.length
                : startIndex >= renderedPages.length - 1;
        } else {
            pageTargetMeta.textContent = 'Editing: Page 1';
            previewPrevBtn.disabled = true;
            previewNextBtn.disabled = true;
        }
    }

    async function exportPDF() {
        if (!window.jspdf || !window.html2canvas) {
            alert('PDF tools are still loading. Please try again in a moment.');
            return;
        }

        if (!renderedPages.length) {
            renderPreview();
        }

        if (!renderedPages.length) {
            alert('Please insert data before downloading the PDF.');
            return;
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'px',
            format: [A4_WIDTH_PX, A4_HEIGHT_PX],
            hotfixes: ['px_scaling']
        });

        const exportHost = document.createElement('div');
        exportHost.style.position = 'fixed';
        exportHost.style.left = '-10000px';
        exportHost.style.top = '0';
        exportHost.style.width = `${A4_WIDTH_PX}px`;
        exportHost.style.background = '#ffffff';
        exportHost.style.pointerEvents = 'none';

        const previousEditMode = editMode;
        editMode = false;
        document.body.classList.add('is-pdf-export');
        exportBtn.disabled = true;
        exportBtn.textContent = 'Preparing PDF...';

        try {
            document.body.appendChild(exportHost);

            for (let pageIndex = 0; pageIndex < renderedPages.length; pageIndex++) {
                exportHost.innerHTML = '';
                const frame = renderPageFrame(pageIndex);
                exportHost.appendChild(frame);

                const canvas = await html2canvas(frame, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    width: A4_WIDTH_PX,
                    height: A4_HEIGHT_PX,
                    windowWidth: A4_WIDTH_PX,
                    windowHeight: A4_HEIGHT_PX
                });

                if (pageIndex > 0) {
                    pdf.addPage([A4_WIDTH_PX, A4_HEIGHT_PX], 'portrait');
                }

                const imageData = canvas.toDataURL('image/jpeg', 0.95);
                pdf.addImage(imageData, 'JPEG', 0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);
            }

            pdf.save('micromize-notes.pdf');
        } catch (error) {
            console.error(error);
            alert('PDF download failed. Please try again.');
        } finally {
            exportHost.remove();
            document.body.classList.remove('is-pdf-export');
            editMode = previousEditMode;
            exportBtn.disabled = false;
            exportBtn.textContent = 'Download PDF';
            displayCurrentPage();
        }
    }

    parsePreviewBtn.addEventListener('click', renderPreview);
    chatInput.addEventListener('input', () => setTimeout(renderPreview, 300));
    previewPrevBtn.addEventListener('click', () => {
        if (currentPageIndex > 0) {
            currentPageIndex = Math.max(0, currentPageIndex - (twoPageView ? 2 : 1));
            displayCurrentPage();
        }
    });
    previewNextBtn.addEventListener('click', () => {
        if (currentPageIndex < renderedPages.length - 1) {
            currentPageIndex = Math.min(renderedPages.length - 1, currentPageIndex + (twoPageView ? 2 : 1));
            displayCurrentPage();
        }
    });

    clearAllBtn.addEventListener('click', () => {
        chatInput.value = '';
        renderPreview();
    });

    function closeAccountMenu() {
        if (!accountMenu || !accountMenuBtn) {
            return;
        }

        accountMenu.hidden = true;
        accountMenuBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleAccountMenu() {
        if (!accountMenu || !accountMenuBtn) {
            return;
        }

        const willOpen = accountMenu.hidden;
        accountMenu.hidden = !willOpen;
        accountMenuBtn.setAttribute('aria-expanded', String(willOpen));
    }

    if (accountMenuBtn && accountMenu) {
        accountMenuBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleAccountMenu();
        });

        accountMenu.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        document.addEventListener('click', closeAccountMenu);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeAccountMenu();
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem(USER_PIN_KEY);
            localStorage.removeItem(USER_PASSWORD_KEY);
            localStorage.removeItem(PAYMENT_STATUS_KEY);
            window.location.href = 'premium.html';
        });
    }

    // Delete Account Handler
    const disableAccountBtn = document.getElementById('disableAccountBtn');
    const deleteAccountModal = document.getElementById('deleteAccountModal');
    const deleteAccountCancelBtn = document.getElementById('deleteAccountCancelBtn');
    const deleteAccountConfirmBtn = document.getElementById('deleteAccountConfirmBtn');
    const modalCloseBtn = deleteAccountModal?.querySelector('.modal-close-btn');
    const deletePasswordConfirm = document.getElementById('deletePasswordConfirm');
    const deleteErrorMsg = document.getElementById('deleteErrorMsg');

    function openDeleteModal() {
        if (deleteAccountModal) {
            deleteAccountModal.style.display = 'flex';
            deleteAccountModal.classList.add('show');
            deletePasswordConfirm.value = '';
            deleteErrorMsg.classList.remove('show');
            deleteErrorMsg.textContent = '';
            deletePasswordConfirm.focus();
        }
    }

    function closeDeleteModal() {
        if (deleteAccountModal) {
            deleteAccountModal.classList.remove('show');
            setTimeout(() => {
                deleteAccountModal.style.display = 'none';
            }, 300);
        }
    }

    if (disableAccountBtn) {
        disableAccountBtn.addEventListener('click', () => {
            closeAccountMenu();
            openDeleteModal();
        });
    }

    if (deleteAccountCancelBtn) {
        deleteAccountCancelBtn.addEventListener('click', closeDeleteModal);
    }

    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', closeDeleteModal);
    }

    if (deleteAccountModal) {
        deleteAccountModal.addEventListener('click', (e) => {
            if (e.target === deleteAccountModal) {
                closeDeleteModal();
            }
        });
    }

    if (deletePasswordConfirm) {
        deletePasswordConfirm.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                deleteAccountConfirmBtn?.click();
            }
        });
    }

    if (deleteAccountConfirmBtn) {
        deleteAccountConfirmBtn.addEventListener('click', async () => {
            const password = deletePasswordConfirm.value.trim();
            const pin = localStorage.getItem(USER_PIN_KEY);

            if (!password) {
                deleteErrorMsg.textContent = 'Please enter your password';
                deleteErrorMsg.classList.add('show');
                return;
            }

            deleteAccountConfirmBtn.disabled = true;
            deleteAccountConfirmBtn.textContent = 'Deleting...';

            try {
                const response = await fetch(getPremiumApiUrl('/api/premium/delete'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ pin, password })
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to delete account');
                }

                // Clear local storage
                localStorage.removeItem(USER_PIN_KEY);
                localStorage.removeItem(USER_PASSWORD_KEY);
                localStorage.removeItem(PAYMENT_STATUS_KEY);
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(SOURCE_TEXT_KEY);
                localStorage.removeItem(SETTINGS_KEY);

                // Show success message
                alert('Your account has been successfully deleted. You will be redirected to the premium page.');
                window.location.href = 'premium.html';
            } catch (error) {
                deleteErrorMsg.textContent = error.message || 'Unable to delete account. Please try again.';
                deleteErrorMsg.classList.add('show');
                deleteAccountConfirmBtn.disabled = false;
                deleteAccountConfirmBtn.textContent = 'Delete Account';
            }
        });
    }

    verifyStoredAccount().then(userPin => {
        if (userPinBadge) {
            userPinBadge.textContent = userPin ? `PIN: ${userPin}` : '';
            userPinBadge.hidden = !userPin;
        }
    });

    fontSizeSlider.addEventListener('input', () => {
        const scaleOffset = parseFloat(fontSizeSlider.value);
        const newSize = BASE_FONT_SIZE + scaleOffset;
        fontSizeValue.textContent = scaleOffset > 0 ? `+${scaleOffset.toFixed(1)}` : scaleOffset.toFixed(1);
        globalPageSettings.fontSize = newSize;
        renderPreview();
    });

    lineHeightSlider.addEventListener('input', () => {
        const newLineHeight = parseFloat(lineHeightSlider.value);
        lineHeightValue.textContent = `${newLineHeight.toFixed(2)}x`;
        globalPageSettings.lineHeight = newLineHeight;
        renderPreview();
    });

    centerFillToggle.addEventListener('change', () => {
        globalPageSettings.centerFill = centerFillToggle.checked;
        centerFillValue.textContent = centerFillToggle.checked ? 'On' : 'Off';
        renderPreview();
    });

    editModeToggle.addEventListener('change', () => {
        editMode = editModeToggle.checked;
        editModeValue.textContent = editMode ? 'On' : 'Off';
        displayCurrentPage();
    });

    twoPageViewBtn.addEventListener('click', () => {
        twoPageView = !twoPageView;
        if (twoPageView) {
            currentPageIndex = Math.floor(currentPageIndex / 2) * 2;
        }
        twoPageViewBtn.classList.toggle('is-active', twoPageView);
        twoPageViewBtn.setAttribute('aria-pressed', String(twoPageView));
        displayCurrentPage();
    });
    exportBtn.addEventListener('click', exportPDF);
    window.addEventListener('resize', () => {
        window.clearTimeout(resizeTimeoutId);
        resizeTimeoutId = window.setTimeout(displayCurrentPage, 120);
    });

    renderPreview();
})();
