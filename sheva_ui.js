/**
 * @file sheva_ui.js - User interface rendering and interaction logic for SHEVA 2.0
 * Handles DOM manipulation, event listeners, visualizations, and hypothesis generation.
 *
 * @author SHEVA Team
 * @version 2.0.0
 */

let currentGeneratedHypotheses = [];
let currentValidatedHypotheses = [];

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENT REFERENCES ---
    const csvFileInput = document.getElementById('csvFileInput');
    const contentArea = document.getElementById('content-area');

    // --- CSV FILE INPUT HANDLER ---
    csvFileInput.addEventListener('change', (event) => {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            window.ShevaCore.loadCSVFile(file, (filename) => {
                renderTable(filename);
            });
        }
    });

    function downloadJSON(data, filename = 'hypotheses.json') {
        try {
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading JSON:', error);
            alert('Erro ao gerar o arquivo JSON.');
        }
    }

    function buildHypothesesExportPayload() {
        const targetIndex = window.ShevaCore.state.targetColumnIndex;
        const targetName = targetIndex !== null
            ? window.ShevaCore.state.tableData.headers[targetIndex]
            : null;

        const targetColumnData = targetIndex !== null
            ? window.ShevaCore.state.tableData.rows
                .map(row => parseFloat(row[targetIndex]))
                .filter(n => !isNaN(n))
            : [];

        const n = targetColumnData.length;
        const mean = n > 0 ? targetColumnData.reduce((a, b) => a + b, 0) / n : null;
        const variance = n > 0
            ? targetColumnData.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n
            : null;

        return {
            system: 'SHEVA-LLM',
            export_version: '1.0',
            exported_at: new Date().toISOString(),
            file_name: csvFileInput.files[0]?.name || 'data',
            target_column: targetName,
            target_mean: mean,
            target_variance: variance,
            total_generated_hypotheses: currentGeneratedHypotheses.length,
            total_validated_hypotheses: currentValidatedHypotheses.length,
            comparison_columns: window.ShevaCore.state.comparisonColumnIndices.map(
                idx => window.ShevaCore.state.tableData.headers[idx]
            ),
            generated_hypotheses: currentGeneratedHypotheses,
            validated_hypotheses: currentValidatedHypotheses
        };
    }

    function renderDownloadHypothesesButton(parentContainer) {
        if (!parentContainer) return;

        const existingWrapper = document.getElementById('download-hypotheses-wrapper');
        if (existingWrapper) {
            existingWrapper.remove();
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'download-hypotheses-wrapper';
        wrapper.className = 'mt-6 pt-4 border-t flex justify-end';

        const button = document.createElement('button');
        button.id = 'download-hypotheses-btn';
        button.className = 'bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700 transition duration-300 flex items-center';
        button.innerHTML = `<i class="fas fa-download mr-2"></i>Download hypotheses JSON`;

        const hasHypotheses = currentGeneratedHypotheses.length > 0 || currentValidatedHypotheses.length > 0;
        if (!hasHypotheses) {
            button.disabled = true;
            button.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            button.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
        }

        button.addEventListener('click', () => {
            const payload = buildHypothesesExportPayload();
            const filenameBase = (csvFileInput.files[0]?.name || 'dataset').replace(/\.[^/.]+$/, '');
            downloadJSON(payload, `${filenameBase}_sheva_hypotheses.json`);
        });

        wrapper.appendChild(button);
        parentContainer.appendChild(wrapper);
    }

    // --- COLLAPSIBLE STATE MANAGEMENT ---

    /**
     * Saves the current state of all collapsible sections.
     */
    function saveCollapsibleStates() {
        document.querySelectorAll('.collapsible-section').forEach(section => {
            const id = section.id;
            const content = section.querySelector('.collapsible-content, .collapsible-content-static');
            if (id && content) {
                window.ShevaCore.state.collapsibleStates[id] = content.classList.contains('expanded');
            }
        });
    }

    /**
     * Toggles the visibility of a collapsible section.
     * @param {HTMLElement} headerElement - The header element clicked.
     */
    function toggleCollapse(headerElement) {
        if (headerElement.dataset.interactive !== 'true') return;

        const content = headerElement.nextElementSibling;
        const icon = headerElement.querySelector('.collapse-icon');
        const sectionId = headerElement.closest('.collapsible-section').id;

        if (content.classList.contains('expanded')) {
            content.style.overflow = 'hidden';
            content.style.maxHeight = '0px';
            content.classList.remove('expanded');
            icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
            window.ShevaCore.state.collapsibleStates[sectionId] = false;
        } else {
            content.style.maxHeight = content.scrollHeight + "px";
            content.classList.add('expanded');
            icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
            window.ShevaCore.state.collapsibleStates[sectionId] = true;

            content.addEventListener('transitionend', function onTransitionEnd() {
                content.style.overflow = 'visible';
                content.removeEventListener('transitionend', onTransitionEnd);
            });
        }
    }

    /**
     * Activates a previously static collapsible section.
     * @param {string} sectionId - The ID of the section to activate.
     */
    function activateCollapsible(sectionId) {
        const section = document.getElementById(sectionId);
        if (!section) return;

        const header = section.querySelector('.collapsible-header');
        const icon = header.querySelector('.collapse-icon');
        const content = section.querySelector('.collapsible-content-static, .collapsible-content');

        if (header.dataset.interactive === 'false') {
            header.dataset.interactive = 'true';
            header.classList.add('cursor-pointer');
            icon.classList.remove('hidden');
            content.classList.replace('collapsible-content-static', 'collapsible-content');
        }

        if (!content.classList.contains('expanded')) {
            content.classList.add('expanded');
            icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
        }
    }

    /**
     * Updates the maxHeight of a collapsible content area after dynamic content changes.
     * @param {HTMLElement} element - An element inside the collapsible area.
     */
    function updateCollapsibleHeight(element) {
        if (!element) return;
        const content = element.closest('.collapsible-content, .collapsible-content-static');
        if (content && (content.classList.contains('expanded') || content.classList.contains('collapsible-content-static'))) {
            setTimeout(() => {
                content.style.maxHeight = content.scrollHeight + "px";
            }, 100);
        }
    }

    // --- AI PROGRESS BAR ---

    let animatedProgressValue = 0;
    let progressAnimationFrame = null;

    function ensureAIProgressBox(resultsArea) {
        if (!resultsArea) return;

        let existingProgressBox = document.getElementById('ai-progress-box');
        if (!existingProgressBox) {
            const progressWrapper = document.createElement('div');
            progressWrapper.innerHTML = `
                <div id="ai-progress-box" class="hidden p-4 border rounded-lg bg-white mt-4">
                    <div class="flex justify-between items-center mb-2">
                        <span id="ai-progress-text" class="text-sm text-gray-700">
                            Generating hypotheses... This may take a few seconds.
                        </span>
                        <span id="ai-progress-percent" class="text-sm text-gray-500">0%</span>
                    </div>

                    <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div id="ai-progress-fill" class="h-3 bg-indigo-600" style="width: 0%;"></div>
                    </div>
                </div>
            `;
            resultsArea.prepend(progressWrapper.firstElementChild);
        }
    }

    function showAIProgressBox() {
        document.getElementById('ai-progress-box')?.classList.remove('hidden');
        animatedProgressValue = 0;
        updateAIProgressBar(0, 'Generating hypotheses... This may take a few seconds.', true);
    }

    function hideAIProgressBox() {
        document.getElementById('ai-progress-box')?.classList.add('hidden');
        if (progressAnimationFrame) {
            cancelAnimationFrame(progressAnimationFrame);
            progressAnimationFrame = null;
        }
    }

    function animateProgressBarTo(targetPercent, duration = 700) {
        const fill = document.getElementById('ai-progress-fill');
        const label = document.getElementById('ai-progress-percent');
        if (!fill) return;

        if (progressAnimationFrame) {
            cancelAnimationFrame(progressAnimationFrame);
            progressAnimationFrame = null;
        }

        const startValue = animatedProgressValue || 0;
        const endValue = Math.max(0, Math.min(100, Number(targetPercent) || 0));
        const startTime = performance.now();

        function step(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const current = startValue + (endValue - startValue) * eased;

            animatedProgressValue = current;
            fill.style.width = `${current}%`;

            if (label) {
                label.textContent = `${Math.round(current)}%`;
            }

            if (t < 1) {
                progressAnimationFrame = requestAnimationFrame(step);
            } else {
                animatedProgressValue = endValue;
                fill.style.width = `${endValue}%`;
                if (label) {
                    label.textContent = `${Math.round(endValue)}%`;
                }
                progressAnimationFrame = null;
            }
        }

        progressAnimationFrame = requestAnimationFrame(step);
    }

    function updateAIProgressBar(percent, text, immediate = false) {
        const msg = document.getElementById('ai-progress-text');

        if (immediate) {
            const fill = document.getElementById('ai-progress-fill');
            const label = document.getElementById('ai-progress-percent');
            animatedProgressValue = percent;
            if (fill) fill.style.width = `${percent}%`;
            if (label) label.textContent = `${percent}%`;
        } else {
            animateProgressBarTo(percent, 700);
        }

        if (msg) {
            msg.textContent = text;
        }
    }

    async function pollAIProgress(jobId) {
        while (true) {
            const response = await fetch(`http://localhost:8000/generate_ai_progress/${jobId}`);
            const data = await response.json();

            updateAIProgressBar(
                data.progress ?? 0,
                data.message ?? 'Generating hypotheses... This may take a few seconds.'
            );

            if (data.status === 'completed') {
                await new Promise(resolve => setTimeout(resolve, 500));
                return;
            }

            if (data.status === 'error') {
                throw new Error(data.message || 'AI generation failed.');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    async function runAIHypothesisGeneration(payload) {
        showAIProgressBox();

        try {
            const startResponse = await fetch('http://localhost:8000/generate_ai_async', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!startResponse.ok) {
                throw new Error(`HTTP Error! status: ${startResponse.status}`);
            }

            const startData = await startResponse.json();
            const jobId = startData.job_id;

            await pollAIProgress(jobId);

            updateAIProgressBar(100, 'Finished generating hypotheses. Loading results...');

            const resultResponse = await fetch(`http://localhost:8000/generate_ai_result/${jobId}`);
            if (!resultResponse.ok) {
                throw new Error(`HTTP Error! status: ${resultResponse.status}`);
            }

            const resultData = await resultResponse.json();
            hideAIProgressBox();

            return resultData;
        } catch (error) {
            hideAIProgressBox();
            throw error;
        }
    }

    // --- MAIN TABLE RENDERING ---

    /**
     * Renders the main application interface.
     * @param {string} fileName - The name of the loaded CSV file.
     */
    function renderTable(fileName) {
        saveCollapsibleStates();

        const existingDescription = document.getElementById('dataset-description');
        if (existingDescription) {
            window.ShevaCore.state.datasetDescriptionText = existingDescription.value;
        }

        const getSectionState = (id, defaultState = false) => {
            if (Object.keys(window.ShevaCore.state.collapsibleStates).length === 0) return defaultState;
            return window.ShevaCore.state.collapsibleStates[id] === true;
        };

        const isTargetSelected = window.ShevaCore.state.targetColumnIndex !== null;
        const isHypothesisReady = window.ShevaCore.state.isDataDiscretized;
        const isComparisonSelected = window.ShevaCore.state.comparisonColumnIndices.length > 0;

        const sampleState = getSectionState('data-sample-section', true);
        const descriptionState = getSectionState('description-section', true);

        let tableHTML = `
            <div id="data-sample-section" class="collapsible-section">
                <div class="flex justify-between items-center mb-4 cursor-pointer collapsible-header" data-interactive="true">
                    <h2 class="text-xl font-semibold">Data Sample (${fileName} - ${window.ShevaCore.state.tableData.rows.length} records)</h2>
                    <i class="fas ${sampleState ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-600 collapse-icon"></i>
                </div>

                <div class="collapsible-content ${sampleState ? 'expanded' : ''}">
                    <div class="flex justify-between items-center mb-2">
                        <div class="text-xs text-gray-500 flex items-center space-x-4">
                            <span><i class="fas fa-pencil-alt mr-1"></i>Rename</span>
                            <span><i class="fas fa-trash-alt mr-1"></i>Delete</span>
                            <span><i class="fas fa-bullseye mr-1"></i>Set as Target</span>
                            <span><i class="fas fa-users mr-1"></i>Compare Groups</span>
                            <span><i class="fas fa-exchange-alt mr-1"></i>Map to 0/1</span>
                        </div>
                        <button id="discretize-btn" class="font-bold py-2 px-4 rounded-lg transition duration-300 flex items-center text-sm
                            ${isTargetSelected ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}"
                            ${!isTargetSelected ? 'disabled' : ''}>
                            <i class="fas fa-cut mr-2"></i>Discretize Numeric Data
                        </button>
                    </div>
                    <div class="overflow-x-auto w-full">
                        <table class="min-w-full bg-white border border-gray-200">
                            <thead class="bg-gray-100">
                                <tr>`;

        window.ShevaCore.state.tableData.headers.forEach((header, index) => {
            const isNumeric = window.ShevaCore.isColumnNumeric(index);
            const isTarget = index === window.ShevaCore.state.targetColumnIndex;
            const isComparison = window.ShevaCore.state.comparisonColumnIndices.includes(index);

            let targetIconHTML = '';
            if (isNumeric) {
                targetIconHTML = `<i class="fas fa-bullseye ml-3 ${isTarget ? 'text-green-500' : 'text-gray-400'} hover:text-green-600 cursor-pointer target-icon" data-index="${index}" title="Set as target column"></i>`;
            }

            let binaryIconHTML = '';
            if (!isNumeric) {
                binaryIconHTML = `<i class="fas fa-exchange-alt ml-3 text-gray-400 hover:text-indigo-600 cursor-pointer map-binary-icon" data-index="${index}" title="Map this column to 0/1"></i>`;
            }

            let comparisonIconHTML = '';
            if (window.ShevaCore.state.isDataDiscretized && !isTarget) {
                comparisonIconHTML = `<i class="fas fa-users ml-3 ${isComparison ? 'text-purple-500' : 'text-gray-400'} hover:text-purple-600 cursor-pointer compare-groups-icon" data-index="${index}" title="Set as comparison column"></i>`;
            } else if (!window.ShevaCore.state.isDataDiscretized && !isTarget) {
                comparisonIconHTML = `<i class="fas fa-users ml-3 text-gray-200 cursor-not-allowed" title="Discretize data to enable group comparison"></i>`;
            }

            tableHTML += `
                <th class="px-4 py-3 border-b-2 border-gray-200 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    <div class="flex items-center justify-between">
                        <span class="column-name mr-2">${header}</span>
                        <input type="text" class="column-rename-input hidden flex-grow" value="${header}">
                        <div class="flex items-center">
                            <i class="fas fa-pencil-alt text-gray-400 hover:text-blue-500 cursor-pointer rename-icon" data-index="${index}"></i>
                            <i class="fas fa-trash-alt ml-3 text-gray-400 hover:text-red-500 cursor-pointer delete-icon" data-index="${index}"></i>
                            ${binaryIconHTML}
                            ${comparisonIconHTML}
                            ${targetIconHTML}
                        </div>
                    </div>
                </th>`;
        });

        tableHTML += `</tr></thead><tbody class="text-gray-700">`;

        window.ShevaCore.state.tableData.rows.slice(0, 5).forEach((row, rowIndex) => {
            const rowClass = rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            tableHTML += `<tr class="${rowClass}">`;
            row.forEach(cell => {
                tableHTML += `<td class="px-6 py-4 border-b border-gray-200 whitespace-nowrap">${cell}</td>`;
            });
            tableHTML += `</tr>`;
        });

        tableHTML += `</tbody></table></div></div></div>

            <div id="description-section" class="mt-6 pt-6 border-t collapsible-section">
                <div class="flex justify-between items-center mb-4 cursor-pointer collapsible-header" data-interactive="true">
                    <h3 class="text-xl font-semibold">Dataset Description (Optional)</h3>
                    <i class="fas ${descriptionState ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-600 collapse-icon"></i>
                </div>
                <div class="collapsible-content ${descriptionState ? 'expanded' : ''}">
                    <textarea id="dataset-description" class="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" rows="4"
                              placeholder="Describe the context and objective of this dataset analysis. This information will help the LLM generate more relevant and contextualized insights.">${window.ShevaCore.state.datasetDescriptionText}</textarea>
                </div>
            </div>

            <div id="summary-dashboard-panel" class="mt-6 pt-6 border-t collapsible-section">
                <div class="flex justify-between items-center mb-4 collapsible-header" data-interactive="false">
                    <h3 class="text-xl font-semibold">Overall Dataset Summary</h3>
                    <i class="fas fa-chevron-down text-gray-600 collapse-icon hidden"></i>
                </div>
                <div class="collapsible-content-static">
                    <div class="flex items-center space-x-4 mb-4 bg-gray-50 p-4 rounded-lg">
                        <p class="flex-grow">Click the button to generate comparative charts for all columns.</p>
                        <button id="generate-summary-btn" class="bg-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-purple-700 transition duration-300">
                            <i class="fas fa-binoculars mr-2"></i>Generate Summary
                        </button>
                    </div>
                    <div id="summary-numeric-chart-container" class="mt-4 p-4 bg-white border rounded-lg" style="height: 400px; display: none;">
                        <canvas id="summary-numeric-chart"></canvas>
                    </div>
                    <div id="summary-categorical-chart-container" class="mt-4 p-4 bg-white border rounded-lg" style="height: 400px; display: none;">
                        <canvas id="summary-categorical-chart"></canvas>
                    </div>
                </div>
            </div>

            <div id="dashboard-panel" class="mt-6 pt-6 border-t collapsible-section">
                <div class="flex justify-between items-center mb-4 collapsible-header" data-interactive="false">
                    <h3 class="text-xl font-semibold">Detailed Column Analysis</h3>
                    <i class="fas fa-chevron-down text-gray-600 collapse-icon hidden"></i>
                </div>
                <div class="collapsible-content-static">
                    <div class="flex items-center space-x-4 mb-4 bg-gray-50 p-4 rounded-lg">
                        <label for="column-select" class="font-medium">Analyze Column:</label>
                        <select id="column-select" class="flex-grow p-2 border border-gray-300 rounded-md">
                            ${window.ShevaCore.state.tableData.headers.map(h => `<option value="${h}">${h}</option>`).join('')}
                        </select>
                        <button id="generate-dashboard-btn" class="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700 transition duration-300">
                            <i class="fas fa-chart-line mr-2"></i>Analyze
                        </button>
                    </div>
                    <div id="dashboard-content" class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-6" style="display: none;">
                        <div id="stats-cards" class="md:col-span-1 grid grid-cols-2 gap-4 content-start"></div>
                        <div id="chart-container" class="md:col-span-2 p-4 bg-white border rounded-lg" style="height: 400px;">
                            <canvas id="analysis-chart"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <div id="hypothesis-panel-placeholder"></div>
        `;

        contentArea.innerHTML = tableHTML;

        if (typeof initializeHypothesisPanel === 'function') {
            initializeHypothesisPanel(isHypothesisReady, isComparisonSelected);
        }

        addEventListeners();

        setTimeout(() => {
            document.querySelectorAll('.collapsible-content.expanded').forEach(content => {
                content.style.maxHeight = content.scrollHeight + "px";
                content.style.overflow = 'visible';
            });
        }, 10);
    }

    // --- EVENT LISTENERS ---

    /**
     * Attaches event listeners to all interactive elements.
     */
    function addEventListeners() {
        document.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', () => toggleCollapse(header));
        });

        document.querySelectorAll('.rename-icon').forEach(icon =>
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                enableRename(e.currentTarget);
            })
        );

        document.querySelectorAll('.delete-icon').forEach(icon =>
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.currentTarget.dataset.index);
                window.ShevaCore.deleteColumn(index);
                renderTable(csvFileInput.files[0]?.name || 'data');
            })
        );

        document.querySelectorAll('.target-icon').forEach(icon =>
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.currentTarget.dataset.index);
                window.ShevaCore.selectTargetColumn(index);
                renderTable(csvFileInput.files[0]?.name || 'data');
            })
        );

        document.querySelectorAll('.compare-groups-icon').forEach(icon =>
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.currentTarget.dataset.index);
                window.ShevaCore.selectComparisonColumn(index);
                renderTable(csvFileInput.files[0]?.name || 'data');
            })
        );

        document.querySelectorAll('.map-binary-icon').forEach(icon =>
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.currentTarget.dataset.index);
                window.ShevaCore.mapColumnToBinary(index);
                renderTable(csvFileInput.files[0]?.name || 'data');
            })
        );

        document.getElementById('discretize-btn')?.addEventListener('click', () => {
            window.ShevaCore.discretizeData();
            renderTable(csvFileInput.files[0]?.name || 'data');
        });

        document.getElementById('generate-summary-btn')?.addEventListener('click', generateSummaryCharts);
        document.getElementById('generate-dashboard-btn')?.addEventListener('click', generateDashboard);
    }

    /**
     * Enables inline editing for a column header.
     * @param {HTMLElement} icon - The rename icon element.
     */
    function enableRename(icon) {
        const th = icon.closest('th');
        const nameSpan = th.querySelector('.column-name');
        const renameInput = th.querySelector('.column-rename-input');
        const iconsDiv = th.querySelector('.flex.items-center:not(.justify-between)');

        th.style.minWidth = `${th.offsetWidth}px`;
        nameSpan.classList.add('hidden');
        iconsDiv.classList.add('hidden');
        renameInput.classList.remove('hidden');
        renameInput.focus();

        const save = () => {
            const index = parseInt(icon.dataset.index);
            const newName = renameInput.value.trim();
            window.ShevaCore.renameColumn(index, newName);
            renderTable(csvFileInput.files[0]?.name || 'data');
        };

        renameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') save(); });
        renameInput.addEventListener('blur', save);
    }

    // --- CHART GENERATION ---

    /**
     * Generates summary charts for all columns.
     */
    function generateSummaryCharts() {
        const numericStats = [];
        const categoricalStats = { columns: [], allCategories: new Set(), frequencies: {} };

        window.ShevaCore.state.tableData.headers.forEach((header, index) => {
            if (window.ShevaCore.isColumnNumeric(index)) {
                const numericData = window.ShevaCore.state.tableData.rows
                    .map(row => parseFloat(row[index]))
                    .filter(n => !isNaN(n));

                if (numericData.length > 0) {
                    const n = numericData.length;
                    const sum = numericData.reduce((a, b) => a + b, 0);
                    numericData.sort((a, b) => a - b);

                    numericStats.push({
                        name: header,
                        mean: sum / n,
                        median: n % 2 === 0 ? (numericData[n / 2 - 1] + numericData[n / 2]) / 2 : numericData[Math.floor(n / 2)],
                        max: numericData[numericData.length - 1],
                        min: numericData[0]
                    });
                }
            } else {
                const columnData = window.ShevaCore.state.tableData.rows.map(row => row[index]);
                const validData = columnData.filter(val => val != null && val.toString().trim() !== '');

                if (validData.length > 0) {
                    categoricalStats.columns.push(header);
                    const freqs = validData.reduce((acc, val) => {
                        acc[val] = (acc[val] || 0) + 1;
                        categoricalStats.allCategories.add(val);
                        return acc;
                    }, {});
                    categoricalStats.frequencies[header] = freqs;
                }
            }
        });

        document.getElementById('summary-numeric-chart-container').style.display = numericStats.length > 0 ? 'block' : 'none';
        document.getElementById('summary-categorical-chart-container').style.display = categoricalStats.columns.length > 0 ? 'block' : 'none';

        activateCollapsible('summary-dashboard-panel');
        renderNumericSummaryChart(numericStats);
        renderCategoricalSummaryChart(categoricalStats);
    }

    /**
     * Renders numeric summary chart.
     */
    function renderNumericSummaryChart(numericStats) {
        const container = document.getElementById('summary-numeric-chart-container');
        const ctx = document.getElementById('summary-numeric-chart').getContext('2d');

        if (window.ShevaCore.state.summaryNumericChartInstance) {
            window.ShevaCore.state.summaryNumericChartInstance.destroy();
        }

        window.ShevaCore.state.summaryNumericChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: numericStats.map(s => s.name),
                datasets: [
                    { label: 'Mean', data: numericStats.map(s => s.mean), backgroundColor: 'rgba(54, 162, 235, 0.7)' },
                    { label: 'Median', data: numericStats.map(s => s.median), backgroundColor: 'rgba(75, 192, 192, 0.7)' },
                    { label: 'Maximum', data: numericStats.map(s => s.max), backgroundColor: 'rgba(255, 99, 132, 0.7)' },
                    { label: 'Minimum', data: numericStats.map(s => s.min), backgroundColor: 'rgba(255, 206, 86, 0.7)' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, type: 'logarithmic' } },
                plugins: { title: { display: true, text: 'Statistical Comparison of Numeric Columns' } },
                animation: { onComplete: () => updateCollapsibleHeight(container) }
            }
        });
    }

    /**
     * Renders categorical summary chart.
     */
    function renderCategoricalSummaryChart(categoricalStats) {
        const container = document.getElementById('summary-categorical-chart-container');
        const ctx = document.getElementById('summary-categorical-chart').getContext('2d');

        if (window.ShevaCore.state.summaryCategoricalChartInstance) {
            window.ShevaCore.state.summaryCategoricalChartInstance.destroy();
        }

        const uniqueCategoryList = Array.from(categoricalStats.allCategories);
        const colors = ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#eeca3b', '#b279a2', '#ff9da6', '#9d755d', '#bab0ac'];

        const datasets = uniqueCategoryList.map((category, i) => ({
            label: category,
            data: categoricalStats.columns.map(colName => {
                const freqs = categoricalStats.frequencies[colName];
                const total = Object.values(freqs).reduce((a, b) => a + b, 0);
                return total > 0 ? ((freqs[category] || 0) / total) * 100 : 0;
            }),
            backgroundColor: colors[i % colors.length]
        }));

        window.ShevaCore.state.summaryCategoricalChartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: categoricalStats.columns, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'Percentage Composition of Categorical Columns' },
                    tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.raw.toFixed(2)}%` } }
                },
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, min: 0, max: 100, ticks: { callback: (value) => value + "%" } }
                },
                animation: { onComplete: () => updateCollapsibleHeight(container) }
            }
        });
    }

    /**
     * Generates detailed dashboard for selected column.
     */
    function generateDashboard() {
        document.getElementById('dashboard-content').style.display = 'grid';
        activateCollapsible('dashboard-panel');

        const select = document.getElementById('column-select');
        const selectedColumnName = select.value;
        const columnIndex = window.ShevaCore.state.tableData.headers.indexOf(selectedColumnName);

        if (columnIndex === -1) return alert("Column not found.");

        const columnData = window.ShevaCore.state.tableData.rows.map(row => row[columnIndex]);
        const validData = columnData.filter(val => val != null && val.toString().trim() !== '');

        if (window.ShevaCore.isColumnNumeric(columnIndex)) {
            const numericData = validData.map(Number).filter(n => !isNaN(n));
            generateNumericDashboard(selectedColumnName, numericData, columnData.length);
        } else {
            generateCategoricalDashboard(selectedColumnName, validData, columnData.length);
        }
    }

    /**
     * Creates a statistic card HTML.
     */
    function createStatCard(title, value, icon) {
        return `
            <div class="bg-white p-4 rounded-lg border flex items-start">
                <div class="bg-blue-100 text-blue-600 rounded-full p-3 mr-4">
                    <i class="fas ${icon}"></i>
                </div>
                <div>
                    <p class="text-sm text-gray-500">${title}</p>
                    <p class="text-2xl font-bold text-gray-800">${value}</p>
                </div>
            </div>`;
    }

    /**
     * Generates numeric dashboard content.
     */
    function generateNumericDashboard(columnName, data, totalRows) {
        const n = data.length;
        const sum = data.reduce((a, b) => a + b, 0);
        const mean = (sum / n) || 0;
        data.sort((a, b) => a - b);
        const median = n % 2 === 0 ? (data[n / 2 - 1] + data[n / 2]) / 2 : data[Math.floor(n / 2)];
        const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
        const stdDev = Math.sqrt(variance);
        const min = data[0];
        const max = data[data.length - 1];
        const nulls = totalRows - n;

        const statsCards = document.getElementById('stats-cards');
        statsCards.innerHTML = createStatCard('Mean', mean.toFixed(2), 'fa-calculator') +
            createStatCard('Median', median.toFixed(2), 'fa-arrows-alt-h') +
            createStatCard('Std. Deviation', stdDev.toFixed(2), 'fa-wave-square') +
            createStatCard('Minimum', min.toFixed(2), 'fa-arrow-down') +
            createStatCard('Maximum', max.toFixed(2), 'fa-arrow-up') +
            createStatCard('Null Values', nulls, 'fa-question-circle');

        const binCount = 10;
        const binSize = (max - min) / binCount;
        const bins = Array(binCount).fill(0);
        const labels = Array.from({ length: binCount }, (_, i) =>
            `${(min + i * binSize).toFixed(1)}-${(min + (i + 1) * binSize).toFixed(1)}`
        );

        data.forEach(value => {
            let binIndex = Math.floor((value - min) / binSize);
            if (binIndex === binCount) binIndex--;
            bins[binIndex]++;
        });

        renderAnalysisChart('bar', labels, bins, `Distribution of ${columnName}`);
    }

    /**
     * Generates categorical dashboard content.
     */
    function generateCategoricalDashboard(columnName, data, totalRows) {
        const frequencies = data.reduce((acc, val) => {
            acc[val] = (acc[val] || 0) + 1;
            return acc;
        }, {});

        const sortedCategories = Object.entries(frequencies).sort((a, b) => b[1] - a[1]);
        const uniqueCount = sortedCategories.length;
        const mode = uniqueCount > 0 ? sortedCategories[0][0] : 'N/A';
        const nulls = totalRows - data.length;

        const statsCards = document.getElementById('stats-cards');
        statsCards.innerHTML = createStatCard('Unique Categories', uniqueCount, 'fa-tags') +
            createStatCard('Mode', mode, 'fa-star') +
            createStatCard('Null Values', nulls, 'fa-question-circle');

        const top10 = sortedCategories.slice(0, 10);
        const labels = top10.map(item => item[0]);
        const values = top10.map(item => item[1]);

        renderAnalysisChart('bar', labels, values, `Frequency of ${columnName} (Top 10)`);
    }

    /**
     * Renders or updates the analysis chart.
     */
    function renderAnalysisChart(type, labels, data, title) {
        const container = document.getElementById('chart-container');
        const ctx = document.getElementById('analysis-chart').getContext('2d');

        if (window.ShevaCore.state.analysisChartInstance) {
            window.ShevaCore.state.analysisChartInstance.destroy();
        }

        window.ShevaCore.state.analysisChartInstance = new Chart(ctx, {
            type: type,
            data: {
                labels: labels,
                datasets: [{
                    label: title,
                    data: data,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                animation: { onComplete: () => updateCollapsibleHeight(container) }
            }
        });
    }

    // --- HYPOTHESIS GENERATION ---

    /**
     * Generates hypotheses by calling the backend API.
     */
    const generateHypotheses = (generationParams, appendHypotheses = false) => {
        if (window.ShevaCore.state.targetColumnIndex === null) {
            alert("Please select a target column before generating hypotheses.");
            return;
        }
        if (!window.ShevaCore.state.isDataDiscretized) {
            alert("Please discretize the data before generating hypotheses.");
            return;
        }

        const resultsArea = document.getElementById('hypothesis-results-area');

        const hasAIOnly =
            generationParams &&
            generationParams.ai_agent &&
            Object.keys(generationParams).length === 1;

        if (hasAIOnly) {
            ensureAIProgressBox(resultsArea);
            showAIProgressBox();
        } else if (!appendHypotheses) {
            resultsArea.innerHTML = `
                <div class="text-center text-gray-600 p-8">
                    <i class="fas fa-cog fa-spin text-2xl mb-3"></i>
                    <p class="font-medium">Generating hypotheses...</p>
                    <p class="text-sm text-gray-500">Please wait.</p>
                </div>`;
        }

        activateCollapsible('hypothesis-generation-panel');
        updateCollapsibleHeight(resultsArea);

        const stringifiedRows = window.ShevaCore.state.tableData.rows.map(row => row.map(cell => String(cell)));

        const payload = {
            headers: window.ShevaCore.state.tableData.headers,
            rows: stringifiedRows,
            target_column_index: window.ShevaCore.state.targetColumnIndex,
            description: document.getElementById('dataset-description').value,
            methods: generationParams,
            comparison_column_indices: window.ShevaCore.state.comparisonColumnIndices
        };

        const requestPromise = hasAIOnly
            ? runAIHypothesisGeneration(payload)
            : fetch("http://localhost:8000/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }).then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP Error! status: ${response.status}`);
                }
                return response.json();
            });

        requestPromise
            .then(data => {
                console.log("Response from backend:", data);

                if (!appendHypotheses || !document.getElementById('tab-table')) {
                    resultsArea.innerHTML = `
                    <nav class="-mb-px flex space-x-8" aria-label="Tabs">
                        <button id="tab-table" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-blue-600 border-blue-600" data-tab="table">
                            <i class="fas fa-table mr-2"></i>Table View
                        </button>
                        <button id="tab-tree" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="tree">
                            <i class="fas fa-sitemap mr-2"></i>Tree View
                        </button>
                        <button id="tab-sunburst" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="sunburst">
                            <i class="fas fa-chart-pie mr-2"></i>Sunburst View
                        </button>
                        <!-- <button id="tab-cloud" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="cloud">
                            <i class="fas fa-cloud mr-2"></i>Hypothesis Cloud
                        </button>
                         <button id="tab-heatmap" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="heatmap">
                            <i class="fas fa-th mr-2"></i>Hypothesis Heatmap
                        </button>
                        <button id="tab-metrics" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="metrics">
                            <i class="fas fa-chart-line mr-2"></i>Metrics Analysis
                        </button> -->
                    </nav>
                    <div id="tab-content-table" class="tab-content-panel">
                        <div id="hypothesis-tables-container"></div>
                    </div>
                    <div id="tab-content-tree" class="tab-content-panel hidden">
                         <div id="tree-container" class="p-2 border rounded-lg bg-white min-h-[600px] overflow-auto"></div>
                    </div>
                    <div id="tab-content-sunburst" class="tab-content-panel hidden">
                        <div id="sunburst-plot-container" class="border rounded-lg p-2 flex items-center justify-center" style="height: 800px;"></div>
                    </div>
                    <div id="tab-content-cloud" class="tab-content-panel hidden">
                       <div id="hypotheses-cloud-container"></div>
                    </div>
                    <div id="tab-content-heatmap" class="tab-content-panel hidden">
                       <div id="hypotheses-heatmap-container"></div>
                    </div>
                    <div id="tab-content-metrics" class="tab-content-panel hidden">
                       <div id="hypotheses-heatmap-metrics"></div>
                    </div>
                    <div id="hypotheses-download-container"></div>
                `;

                    document.querySelectorAll('.tab-btn').forEach(button => {
                        button.addEventListener('click', () => {
                            const tabId = button.dataset.tab;

                            document.querySelectorAll('.tab-btn').forEach(btn => {
                                btn.classList.remove('text-blue-600', 'border-blue-600');
                                btn.classList.add('text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300', 'border-transparent');
                            });
                            button.classList.add('text-blue-600', 'border-blue-600');

                            document.querySelectorAll('.tab-content-panel').forEach(panel => {
                                panel.classList.add('hidden');
                            });
                            document.getElementById(`tab-content-${tabId}`).classList.remove('hidden');
                            updateCollapsibleHeight(resultsArea);
                        });
                    });
                }

                if (data && data.final_hypotheses_df) {
                    const targetColumnData = window.ShevaCore.state.tableData.rows
                        .map(row => parseFloat(row[window.ShevaCore.state.targetColumnIndex]))
                        .filter(n => !isNaN(n));

                    const n = targetColumnData.length;
                    const mean = n > 0 ? targetColumnData.reduce((a, b) => a + b, 0) / n : 0;
                    const variance = n > 0 ? targetColumnData.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n : 0;

                    const targetInfoForDisplay = {
                        name: window.ShevaCore.state.tableData.headers[window.ShevaCore.state.targetColumnIndex],
                        mean: mean,
                        variance: variance
                    };

                    window.hypothesesApp.fullDataset = JSON.parse(JSON.stringify(window.ShevaCore.state.tableData));
                    window.hypothesesApp.targetInfo = targetInfoForDisplay;

                    let finalHypotheses = data.final_hypotheses_df;

                    if (appendHypotheses && window.hypothesesApp.sortedHypotheses) {
                        const existingHypotheses = window.hypothesesApp.sortedHypotheses;
                        const combined = [...existingHypotheses, ...finalHypotheses];

                        const uniqueMap = new Map();
                        combined.forEach(hyp => {
                            if (!uniqueMap.has(hyp.Hypothesis_Text)) {
                                uniqueMap.set(hyp.Hypothesis_Text, hyp);
                            } else {
                                const existing = uniqueMap.get(hyp.Hypothesis_Text);
                                if (existing.source_method && hyp.source_method && !existing.source_method.includes(hyp.source_method)) {
                                    existing.source_method += ", " + hyp.source_method;
                                }
                            }
                        });
                        finalHypotheses = Array.from(uniqueMap.values());
                    }

                    const hypotheses = finalHypotheses;

                    currentGeneratedHypotheses = data.generated_hypotheses_df ||
                        data.all_hypotheses_df ||
                        data.raw_hypotheses_df ||
                        data.final_hypotheses_df ||
                        [];

                    currentValidatedHypotheses = data.final_hypotheses_df || [];

                    const categorized = {
                        'greater than': [],
                        'less than': [],
                        'variance is higher': []
                    };

                    hypotheses.forEach(hyp => {
                        if (hyp.Operator.includes('greater than')) {
                            categorized['greater than'].push(hyp);
                        } else if (hyp.Operator.includes('less than')) {
                            categorized['less than'].push(hyp);
                        } else if (hyp.Operator.includes('variance is higher')) {
                            categorized['variance is higher'].push(hyp);
                        }
                    });

                    window.hypothesesApp.categorizedHypotheses = categorized;

                    setupAndRenderHypotheses(hypotheses, data.sunburst_json, targetInfoForDisplay, window.ShevaCore.state.tableData);

                    const downloadContainer = document.getElementById('hypotheses-download-container');
                    renderDownloadHypothesesButton(downloadContainer);

                    if (appendHypotheses) {
                        const chatBox = document.getElementById('ai-chat-messages');
                        if (chatBox) {
                            const feedbackDiv = document.createElement('div');
                            feedbackDiv.className = 'mt-4 text-center';
                            feedbackDiv.innerHTML = `
                                <span class="bg-green-100 text-green-800 text-xs font-semibold px-3 py-1 rounded-full">
                                    <i class="fas fa-check-circle mr-1"></i>
                                    New hypothesis round completed and appended to the interface!
                                </span>`;
                            chatBox.appendChild(feedbackDiv);
                            chatBox.scrollTop = chatBox.scrollHeight;

                            const btn = document.getElementById('run-suggested-agent-btn');
                            if (btn) {
                                btn.disabled = false;
                                btn.classList.remove('opacity-50', 'cursor-not-allowed');
                            }
                        }
                    }
                } else {
                    currentGeneratedHypotheses = [];
                    currentValidatedHypotheses = [];

                    resultsArea.innerHTML = `<div class="text-center text-red-500 p-8">Error: Invalid data format received from the server.</div>`;
                }

                updateCollapsibleHeight(resultsArea);
            })
            .catch(error => {
                console.error("Error calling the backend:", error);
                currentGeneratedHypotheses = [];
                currentValidatedHypotheses = [];

                resultsArea.innerHTML = `
                <div class="text-center text-red-500 p-8">
                    <i class="fas fa-exclamation-triangle text-3xl mb-4"></i>
                    <p class="font-bold">Failed to connect to the backend.</p>
                    <p class="text-sm">Please ensure the Python server is running at http://localhost:8000 and try again.</p>
                </div>`;
                updateCollapsibleHeight(resultsArea);
            });
    };

    window.hypothesesApp.generateHypotheses = generateHypotheses;
});