document.addEventListener('DOMContentLoaded', () => {
    // --- JAVASCRIPT LOGIC ---
    const csvFileInput = document.getElementById('csvFileInput');
    const contentArea = document.getElementById('content-area');

    // Global state variables
    let tableData = {
        headers: [],
        rows: []
    };
    let datasetDescriptionText = '';
    let targetColumnIndex = null;
    let isDataDiscretized = false;
    let collapsibleStates = {};
    let analysisChartInstance = null;
    let summaryNumericChartInstance = null;
    let summaryCategoricalChartInstance = null;

    // Initialize the main application namespace
    if (!window.hypothesesApp) {
        window.hypothesesApp = {};
    }
    
    // State for hypotheses, now part of the global app namespace
    window.hypothesesApp.categorizedHypotheses = {};
    window.hypothesesApp.displayCounts = {};

    csvFileInput.addEventListener('change', (event) => {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onload = function(e) {
                const text = e.target.result;
                const lines = text.split('\n').filter(line => line.trim() !== '');
                if (lines.length < 2) {
                    alert("The CSV file must have a header and at least one data row.");
                    return;
                }
                tableData.headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
                tableData.rows = lines.slice(1).map(row => row.split(',').map(cell => cell.trim().replace(/"/g, '')));
                targetColumnIndex = null;
                datasetDescriptionText = '';
                isDataDiscretized = false;
                collapsibleStates = {};
                renderTable(file.name);
            };
            reader.onerror = () => alert("Error reading the file.");
            reader.readAsText(file);
        }
    });

    function isColumnNumeric(columnIndex) {
        if (!tableData.rows || tableData.rows.length === 0) return false;
        const columnData = tableData.rows.map(row => row[columnIndex]);
        const validData = columnData.filter(val => val != null && val.toString().trim() !== '');
        if (validData.length === 0) return false;
        const numericData = validData.map(Number).filter(n => !isNaN(n));
        return (numericData.length / validData.length) > 0.8;
    }

    function isColumnBinary(columnIndex) {
        if (isColumnNumeric(columnIndex)) {
            return false;
        }
        const uniqueValues = [...new Set(tableData.rows.map(row => row[columnIndex]).filter(val => val != null && val.toString().trim() !== ''))];
        return uniqueValues.length === 2;
    }

    function isTrueContinuous(columnIndex) {
        if (!isColumnNumeric(columnIndex)) {
            return false;
        }
        const uniqueValues = [...new Set(tableData.rows.map(row => row[columnIndex]))];
        return uniqueValues.length > 2;
    }

    function saveCollapsibleStates() {
        document.querySelectorAll('.collapsible-section').forEach(section => {
            const id = section.id;
            const content = section.querySelector('.collapsible-content, .collapsible-content-static');
            if (id && content) {
                collapsibleStates[id] = content.classList.contains('expanded');
            }
        });
    }

    function renderTable(fileName) {
        saveCollapsibleStates();
        const existingDescription = document.getElementById('dataset-description');
        if (existingDescription) {
            datasetDescriptionText = existingDescription.value;
        }

        const getSectionState = (id, defaultState = false) => {
            if (Object.keys(collapsibleStates).length === 0) return defaultState;
            return collapsibleStates[id] === true;
        };

        const isTargetSelected = targetColumnIndex !== null;
        const isHypothesisReady = isDataDiscretized;
        const sampleState = getSectionState('data-sample-section', true);
        const descriptionState = getSectionState('description-section', true);

        let tableHTML = `
            <!-- Data Sample Section -->
            <div id="data-sample-section" class="collapsible-section">
                <div class="flex justify-between items-center mb-4 cursor-pointer collapsible-header" data-interactive="true">
                    <h2 class="text-xl font-semibold">Data Sample (${fileName} - ${tableData.rows.length} records)</h2>
                    <i class="fas ${sampleState ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-600 collapse-icon"></i>
                </div>
                
                <div class="collapsible-content ${sampleState ? 'expanded' : ''}">
                    <div class="flex justify-between items-center mb-2">
                        <div class="text-xs text-gray-500 flex items-center space-x-4">
                            <span><i class="fas fa-pencil-alt mr-1"></i>Rename</span>
                            <span><i class="fas fa-trash-alt mr-1"></i>Delete</span>
                            <span><i class="fas fa-bullseye mr-1"></i>Set as Target</span>
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
        tableData.headers.forEach((header, index) => {
            const isNumeric = isColumnNumeric(index);
            const isBinary = isColumnBinary(index);
            const isTarget = index === targetColumnIndex;
            
            let targetIconHTML = '';
            if (isNumeric) {
                targetIconHTML = `<i class="fas fa-bullseye ml-3 ${isTarget ? 'text-green-500' : 'text-gray-400'} hover:text-green-600 cursor-pointer target-icon" data-index="${index}" title="Set as target column"></i>`;
            }

            let binaryIconHTML = '';
            if (!isNumeric) {
                binaryIconHTML = `<i class="fas fa-exchange-alt ml-3 text-gray-400 hover:text-indigo-600 cursor-pointer map-binary-icon" data-index="${index}" title="Map this column to 0/1"></i>`;
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
                                                ${targetIconHTML}
                                            </div>
                                        </div>
                                    </th>`;
        });
        tableHTML += `</tr></thead><tbody class="text-gray-700">`;
        tableData.rows.slice(0, 5).forEach((row, rowIndex) => {
            const rowClass = rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            tableHTML += `<tr class="${rowClass}">`;
            row.forEach(cell => {
                tableHTML += `<td class="px-6 py-4 border-b border-gray-200 whitespace-nowrap">${cell}</td>`;
            });
            tableHTML += `</tr>`;
        });
        tableHTML += `</tbody></table></div>
                </div>
            </div>

            <!-- Other sections remain the same -->
            <div id="description-section" class="mt-6 pt-6 border-t collapsible-section">
                <div class="flex justify-between items-center mb-4 cursor-pointer collapsible-header" data-interactive="true">
                    <h3 class="text-xl font-semibold">Dataset Description (Optional)</h3>
                    <i class="fas ${descriptionState ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-600 collapse-icon"></i>
                </div>
                <div class="collapsible-content ${descriptionState ? 'expanded' : ''}">
                    <textarea id="dataset-description" class="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" rows="4" 
                              placeholder="Describe the context and objective of this dataset analysis. This information will help the LLM generate more relevant and contextualized insights.">${datasetDescriptionText}</textarea>
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
                            ${tableData.headers.map(h => `<option value="${h}">${h}</option>`).join('')}
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
            initializeHypothesisPanel(isHypothesisReady);
        }

        addEventListeners();
        
        // FIX: Use a short timeout to ensure the browser has rendered the content
        // before we calculate its scrollHeight. This prevents layout overlap issues.
        setTimeout(() => {
            document.querySelectorAll('.collapsible-content.expanded').forEach(content => {
                // Set the correct height based on the fully rendered content
                content.style.maxHeight = content.scrollHeight + "px";
                // Make overflow visible so the horizontal scrollbar can appear
                content.style.overflow = 'visible';
            });
        }, 10); // A small delay is usually enough for the browser to paint the layout
    }

    function toggleCollapse(headerElement) {
        if (headerElement.dataset.interactive !== 'true') return;
        const content = headerElement.nextElementSibling;
        const icon = headerElement.querySelector('.collapse-icon');
        const sectionId = headerElement.closest('.collapsible-section').id;
        
        if (content.classList.contains('expanded')) {
            // Set overflow to hidden BEFORE starting the closing animation
            content.style.overflow = 'hidden';
            content.style.maxHeight = '0px';
            content.classList.remove('expanded');
            icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
            collapsibleStates[sectionId] = false;
        } else {
            content.style.maxHeight = content.scrollHeight + "px";
            content.classList.add('expanded');
            icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
            collapsibleStates[sectionId] = true;

            // Wait for the animation to finish, then set overflow to visible
            content.addEventListener('transitionend', function onTransitionEnd() {
                content.style.overflow = 'visible';
                content.removeEventListener('transitionend', onTransitionEnd);
            });
        }
    }

    function addEventListeners() {
        document.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', () => toggleCollapse(header));
        });

        document.querySelectorAll('.rename-icon').forEach(icon => icon.addEventListener('click', (e) => { e.stopPropagation(); enableRename(e.currentTarget); }));
        document.querySelectorAll('.delete-icon').forEach(icon => icon.addEventListener('click', (e) => { e.stopPropagation(); deleteColumn(parseInt(e.currentTarget.dataset.index)); }));
        document.querySelectorAll('.target-icon').forEach(icon => icon.addEventListener('click', (e) => { e.stopPropagation(); selectTargetColumn(parseInt(e.currentTarget.dataset.index)); }));
        document.querySelectorAll('.map-binary-icon').forEach(icon => icon.addEventListener('click', (e) => { e.stopPropagation(); mapColumnToBinary(parseInt(e.currentTarget.dataset.index)); }));
        
        document.getElementById('discretize-btn')?.addEventListener('click', discretizeData);
        document.getElementById('generate-summary-btn')?.addEventListener('click', generateSummaryCharts);
        document.getElementById('generate-dashboard-btn')?.addEventListener('click', generateDashboard);
    }

    function selectTargetColumn(index) {
        if (targetColumnIndex === index) {
            targetColumnIndex = null;
        } else {
            targetColumnIndex = index;
        }
        renderTable(csvFileInput.files[0]?.name || 'data');
    }

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
            if (newName && newName !== tableData.headers[index]) {
                tableData.headers[index] = newName;
            }
            renderTable(csvFileInput.files[0]?.name || 'data');
        };

        renameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') save(); });
        renameInput.addEventListener('blur', save);
    }

    function deleteColumn(index) {
        tableData.headers.splice(index, 1);
        if (index === targetColumnIndex) {
            targetColumnIndex = null;
        } else if (targetColumnIndex !== null && index < targetColumnIndex) {
            targetColumnIndex--;
        }
        tableData.rows.forEach(row => row.splice(index, 1));
        renderTable(csvFileInput.files[0]?.name || 'data');
    }

    function deleteColumn(index) {
        tableData.headers.splice(index, 1);
        if (index === targetColumnIndex) {
            targetColumnIndex = null;
        } else if (targetColumnIndex !== null && index < targetColumnIndex) {
            targetColumnIndex--;
        }
        tableData.rows.forEach(row => row.splice(index, 1));
        renderTable(csvFileInput.files[0]?.name || 'data');
    }

    function mapColumnToBinary(columnIndex) {
        if (isColumnNumeric(columnIndex)) {
            alert("This column is already numeric.");
            return;
        }

        const columnData = tableData.rows.map(row => row[columnIndex]);
        const uniqueValues = [...new Set(columnData.filter(val => val != null && val.toString().trim() !== ''))];

        let valueMap = {};
        let topTwoValues = [];

        if (uniqueValues.length < 2) {
            alert("This column does not have enough unique values to create a binary mapping.");
            return;
        } else if (uniqueValues.length === 2) {
            topTwoValues = uniqueValues;
            valueMap = {
                [topTwoValues[0]]: 0,
                [topTwoValues[1]]: 1
            };
        } else { // More than 2 unique values
            const frequencies = columnData.reduce((acc, val) => {
                if (val != null && val.toString().trim() !== '') {
                    acc[val] = (acc[val] || 0) + 1;
                }
                return acc;
            }, {});

            topTwoValues = Object.entries(frequencies)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 2)
                .map(([value]) => value);
            
            if (topTwoValues.length < 2) {
                 alert("Could not determine two most frequent categories. Please check your data.");
                 return;
            }

            alert(`This column has multiple categories. Mapping the two most frequent:\n- "${topTwoValues[0]}" will be mapped to 1.\n- "${topTwoValues[1]}" will be mapped to 0.\nAll other values will be cleared.`);

            valueMap = {
                [topTwoValues[0]]: 1,
                [topTwoValues[1]]: 0
            };
        }

        const newRows = tableData.rows.map(row => {
            const newRow = [...row];
            const cellValue = newRow[columnIndex];
            
            if (cellValue in valueMap) {
                newRow[columnIndex] = valueMap[cellValue];
            } else if (uniqueValues.length > 2) {
                newRow[columnIndex] = '';
            }
            return newRow;
        });

        tableData.rows = newRows;
        
        alert(`Column "${tableData.headers[columnIndex]}" has been mapped.`);
        renderTable(csvFileInput.files[0]?.name || 'data');
    }

    function discretizeData() {
        if (targetColumnIndex === null) {
            alert("Please select a target column before starting the process.");
            return;
        };

        const newHeaders = [];
        const newRows = tableData.rows.map(() => []);
        const originalTargetHeader = tableData.headers[targetColumnIndex];

        tableData.headers.forEach((header, index) => {
            const isTarget = index === targetColumnIndex;
            const shouldDiscretize = isTrueContinuous(index) && !isTarget;

            if (shouldDiscretize) {
                const newHeaderName = `${header}_Class`;
                newHeaders.push(newHeaderName);
                const numericValues = tableData.rows.map(row => parseFloat(row[index])).filter(v => !isNaN(v));
                
                if (numericValues.length === 0) {
                    tableData.rows.forEach((row, rowIndex) => newRows[rowIndex].push('NA'));
                    return;
                }
                
                const uniqueValues = [...new Set(numericValues)];
                if (uniqueValues.length <= 1) {
                    tableData.rows.forEach((row, rowIndex) => newRows[rowIndex].push(String(uniqueValues[0] || 'NA')));
                    return;
                }

                numericValues.sort((a, b) => a - b);
                
                const getQuantile = (arr, q) => {
                    const pos = (arr.length - 1) * q;
                    const base = Math.floor(pos);
                    const rest = pos - base;
                    if (arr[base + 1] !== undefined) {
                        return arr[base] + rest * (arr[base + 1] - arr[base]);
                    }
                    return arr[base];
                };
                
                const q1 = getQuantile(numericValues, 0.25);
                const q2 = getQuantile(numericValues, 0.50);
                const q3 = getQuantile(numericValues, 0.75);
                
                const binEdges = [...new Set([Math.min(...numericValues), q1, q2, q3, Math.max(...numericValues)])].sort((a, b) => a - b);

                const labels = [];
                for (let i = 0; i < binEdges.length - 1; i++) {
                    labels.push(`${Math.trunc(binEdges[i])}-${Math.trunc(binEdges[i+1])}`);
                }

                tableData.rows.forEach((row, rowIndex) => {
                    const val = parseFloat(row[index]);
                    let binLabel = 'NA';
                    if (!isNaN(val)) {
                        for (let i = 0; i < binEdges.length - 1; i++) {
                            if (i === binEdges.length - 2) {
                                if (val >= binEdges[i] && val <= binEdges[i+1]) {
                                    binLabel = labels[i];
                                    break;
                                }
                            } else {
                                if (val >= binEdges[i] && val < binEdges[i+1]) {
                                    binLabel = labels[i];
                                    break;
                                }
                            }
                        }
                    }
                    newRows[rowIndex].push(binLabel);
                });
            } else if (isColumnNumeric(index) && !isTrueContinuous(index) && !isTarget) {
                newHeaders.push(header);
                tableData.rows.forEach((row, rowIndex) => {
                    newRows[rowIndex].push(String(row[index]));
                });
            } else {
                newHeaders.push(header);
                tableData.rows.forEach((row, rowIndex) => {
                    newRows[rowIndex].push(row[index]);
                });
            }
        });

        tableData.headers = newHeaders;
        tableData.rows = newRows;
        targetColumnIndex = tableData.headers.indexOf(originalTargetHeader);
        isDataDiscretized = true;
        renderTable(csvFileInput.files[0]?.name || 'data');
    }

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

    function updateCollapsibleHeight(element) {
        if (!element) return;
        const content = element.closest('.collapsible-content, .collapsible-content-static');
        if (content && (content.classList.contains('expanded') || content.classList.contains('collapsible-content-static'))) {
            setTimeout(() => {
                content.style.maxHeight = content.scrollHeight + "px";
            }, 100);
        }
    }

    function generateSummaryCharts() {
        const numericStats = [];
        const categoricalStats = { columns: [], allCategories: new Set(), frequencies: {} };

        tableData.headers.forEach((header, index) => {
            if (isColumnNumeric(index)) {
                const numericData = tableData.rows.map(row => parseFloat(row[index])).filter(n => !isNaN(n));
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
                const columnData = tableData.rows.map(row => row[index]);
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

    const generateHypotheses = (generationParams) => {
        if (targetColumnIndex === null) {
            alert("Please select a target column before generating hypotheses.");
            return;
        }
        if (!isDataDiscretized) {
            alert("Please discretize the data before generating hypotheses.");
            return;
        }

        const resultsArea = document.getElementById('hypothesis-results-area');
        resultsArea.innerHTML = `
            <div class="text-center text-gray-500 p-8">
                <i class="fas fa-spinner fa-spin text-3xl mb-4"></i>
                <p>Generating hypotheses... Please wait.</p>
            </div>`;
        
        activateCollapsible('hypothesis-generation-panel');
        updateCollapsibleHeight(resultsArea);

        const stringifiedRows = tableData.rows.map(row => row.map(cell => String(cell)));

        const payload = {
            headers: tableData.headers,
            rows: stringifiedRows,
            target_column_index: targetColumnIndex,
            description: document.getElementById('dataset-description').value,
            methods: generationParams
        };

        fetch("http://localhost:8000/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP Error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("Response from backend:", data);
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
                <button id="tab-cloud" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="cloud">
                    <i class="fas fa-cloud mr-2"></i>Hypotheses Cloud
                </button>
                <button id="tab-heatmap" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="heatmap">
                    <i class="fas fa-th mr-2"></i>Hypotheses Heatmap
                </button>
                <button id="tab-metrics" class="tab-btn whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" data-tab="metrics">
                    <i class="fas fa-chart-line mr-2"></i>Metric Analysis
                </button>
            </nav>

                <!-- Tab Content -->
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
        
            if (data && data.final_hypotheses_df) {
                    const targetColumnData = tableData.rows.map(row => parseFloat(row[targetColumnIndex])).filter(n => !isNaN(n));
                    
                    const n = targetColumnData.length;
                    const mean = n > 0 ? targetColumnData.reduce((a, b) => a + b, 0) / n : 0;
                    const variance = n > 0 ? targetColumnData.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n : 0;

                    const targetInfoForDisplay = {
                        name: tableData.headers[targetColumnIndex],
                        mean: mean,
                        variance: variance
                    };


                   
                    setupAndRenderHypotheses(data.final_hypotheses_df, data.sunburst_json, targetInfoForDisplay, tableData);

                        
            } else {
                resultsArea.innerHTML = `<div class="text-center text-red-500 p-8">Error: Invalid data format received from the server.</div>`;
            }
            updateCollapsibleHeight(resultsArea);
        })
        .catch(error => {
            console.error("Error calling the backend:", error);
            resultsArea.innerHTML = `
                <div class="text-center text-red-500 p-8">
                    <i class="fas fa-exclamation-triangle text-3xl mb-4"></i>
                    <p class="font-bold">Failed to connect to the backend.</p>
                    <p class="text-sm">Please make sure the Python server is running at http://localhost:8000 and try again.</p>
                </div>`;
            updateCollapsibleHeight(resultsArea);
        });
    }

    function renderNumericSummaryChart(numericStats) {
        const container = document.getElementById('summary-numeric-chart-container');
        const ctx = document.getElementById('summary-numeric-chart').getContext('2d');
        if (summaryNumericChartInstance) summaryNumericChartInstance.destroy();

        summaryNumericChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: numericStats.map(s => s.name),
                datasets: [
                    { label: 'Mean', data: numericStats.map(s => s.mean), backgroundColor: 'rgba(54, 162, 235, 0.7)' },
                    { label: 'Median', data: numericStats.map(s => s.median), backgroundColor: 'rgba(75, 192, 192, 0.7)' },
                    { label: 'Max', data: numericStats.map(s => s.max), backgroundColor: 'rgba(255, 99, 132, 0.7)' },
                    { label: 'Min', data: numericStats.map(s => s.min), backgroundColor: 'rgba(255, 206, 86, 0.7)' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, type: 'logarithmic' } },
                plugins: { title: { display: true, text: 'Statistical Comparison of Numeric Columns' } },
                animation: { onComplete: () => updateCollapsibleHeight(container) }
            }
        });
    }

    function renderCategoricalSummaryChart(categoricalStats) {
        const container = document.getElementById('summary-categorical-chart-container');
        const ctx = document.getElementById('summary-categorical-chart').getContext('2d');
        if (summaryCategoricalChartInstance) summaryCategoricalChartInstance.destroy();

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

        summaryCategoricalChartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: categoricalStats.columns, datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
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

    function generateDashboard() {
        document.getElementById('dashboard-content').style.display = 'grid';
        activateCollapsible('dashboard-panel');
        const select = document.getElementById('column-select');
        const selectedColumnName = select.value;
        const columnIndex = tableData.headers.indexOf(selectedColumnName);

        if (columnIndex === -1) return alert("Column not found.");

        const columnData = tableData.rows.map(row => row[columnIndex]);
        const validData = columnData.filter(val => val != null && val.toString().trim() !== '');
        const numericData = validData.map(Number).filter(n => !isNaN(n));
        const isNumeric = numericData.length / validData.length > 0.8;
        
        if (isNumeric) {
            generateNumericDashboard(selectedColumnName, numericData, columnData.length);
        } else {
            generateCategoricalDashboard(selectedColumnName, validData, columnData.length);
        }
    }

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
                                     createStatCard('Min', min.toFixed(2), 'fa-arrow-down') +
                                     createStatCard('Max', max.toFixed(2), 'fa-arrow-up') +
                                     createStatCard('Null Values', nulls, 'fa-question-circle');
        
        const binCount = 10;
        const binSize = (max - min) / binCount;
        const bins = Array(binCount).fill(0);
        const labels = Array.from({length: binCount}, (_, i) => `${(min + i * binSize).toFixed(1)}-${(min + (i + 1) * binSize).toFixed(1)}`);
        data.forEach(value => {
            let binIndex = Math.floor((value - min) / binSize);
            if (binIndex === binCount) binIndex--; // Include max value in the last bin
            bins[binIndex]++;
        });
        renderAnalysisChart('bar', labels, bins, `Distribution of ${columnName}`);
    }

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

    function renderAnalysisChart(type, labels, data, title) {
        const container = document.getElementById('chart-container');
        const ctx = document.getElementById('analysis-chart').getContext('2d');
        if (analysisChartInstance) analysisChartInstance.destroy();
        analysisChartInstance = new Chart(ctx, {
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

    // Expose the main function to be called from generatehypotheses.js
    window.hypothesesApp = {
        generateHypotheses: generateHypotheses
    };
});
