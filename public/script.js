(function() {
    'use strict';

    const STORAGE_KEY = 'alignmentPreviewDataV3';
    const LEGACY_STORAGE_KEY = 'alignmentPreviewDataV2';
    const SOURCE_TEXT_KEY = 'alignmentPreviewSourceV3';
    const SETTINGS_KEY = 'alignmentPreviewSettingsV8';
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

    function getDualPageScale(pageCount) {
        if (!twoPageView) return 1;

        const gap = pageCount > 1 ? 18 : 0;
        const availableWidth = Math.max(320, previewViewport.clientWidth - 28);
        const pairWidth = A4_WIDTH_PX * pageCount + gap;
        return Math.min(1, availableWidth / pairWidth);
    }

    function appendPageFrame(frame, scale) {
        if (!twoPageView) {
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
            const dualScale = getDualPageScale(visibleFrames.length);

            visibleFrames.forEach(frame => appendPageFrame(frame, dualScale));

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

    renderPreview();
})();
