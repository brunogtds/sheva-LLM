// --- HYPOTHESIS ORCHESTRATOR ---
// This file initializes the hypothesis panel and calls the visualization tools
// after receiving data from the backend.

// Stores info about the target column.
let targetInfo = {
    name: 'Target',
    mean: 0,
    variance: 0
};

// --- UTILITY FUNCTIONS ---

/**
 * Calculates a fitness score for each hypothesis and sorts them.
 * @param {Array} hypotheses - Array of hypothesis objects.
 * @returns {Array} A new array of hypotheses sorted by Fitness_Score.
 */
function calculateAndSortByFitnessScore(hypotheses) {
    if (!hypotheses || hypotheses.length === 0) {
        return [];
    }

    let df = JSON.parse(JSON.stringify(hypotheses));

    const weights = {
        Significance_qValue: 0.25,
        Impact_Lift: 0.25,
        Coverage: 0.25,
        Diversity: 0.25,
        Homogeneity: 0.25
    };

    const metrics_to_normalize = ['Impact_Lift', 'Coverage', 'Homogeneity', 'Diversity'];
    metrics_to_normalize.forEach(metric => {
        if (df.every(h => h[metric] !== undefined)) {
            const validValues = df.map(h => h[metric]).filter(v => v !== null && !isNaN(v));
            if (validValues.length === 0) return;
            const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
            df.forEach(h => {
                if (h[metric] === null || isNaN(h[metric])) {
                    h[metric] = mean;
                }
            });

            const minVal = Math.min(...df.map(h => h[metric]));
            const maxVal = Math.max(...df.map(h => h[metric]));
            const range = maxVal - minVal;

            df.forEach(h => {
                h[`${metric}_norm`] = range > 0 ? (h[metric] - minVal) / range : 0.5;
            });
        }
    });

    if (df.every(h => h.Significance_qValue !== undefined)) {
        const epsilon = 1e-10;
        df.forEach(h => {
            h.qValue_transformed = -Math.log10((h.Significance_qValue ?? 1) + epsilon);
        });

        const minQ = Math.min(...df.map(h => h.qValue_transformed));
        const maxQ = Math.max(...df.map(h => h.qValue_transformed));
        const rangeQ = maxQ - minQ;

        df.forEach(h => {
            h.Significance_qValue_norm = rangeQ > 0 ? (h.qValue_transformed - minQ) / rangeQ : 0.5;
        });
    }

    df.forEach(h => {
        h.Fitness_Score = 0.0;
        for (const [metric, weight] of Object.entries(weights)) {
            const norm_col = `${metric}_norm`;
            if (h[norm_col] !== undefined && !isNaN(h[norm_col])) {
                h.Fitness_Score += h[norm_col] * weight;
            }
        }
    });

    return df.sort((a, b) => b.Fitness_Score - a.Fitness_Score);
}

/**
 * Extracts attribute-value pairs from a hypothesis string.
 * @param {string} hypothesisText - The full hypothesis text.
 * @returns {Array<{attribute: string, value: string}>} Array of attribute-value objects.
 */
function extractAttributesFromHypothesis(hypothesisText) {
    if (typeof hypothesisText !== 'string') return [];
    const attributes = [];
    const regex = /`(\w+(?:_\w+)*)`\s+(?:is|=)\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = regex.exec(hypothesisText)) !== null) {
        attributes.push({
            attribute: match[1],
            value: match[2]
        });
    }
    return attributes;
}

// --- PANEL INITIALIZATION AND EVENT HANDLING ---
/**
 * Renders the hypothesis generation panel with tabbed interface.
 * @param {boolean} isHypothesisReady - If true, the generate button is enabled.
 * @param {boolean} isComparisonSelected - If true, comparison methods are available.
 */
function initializeHypothesisPanel(isHypothesisReady, isComparisonSelected) {
    const placeholder = document.getElementById('hypothesis-panel-placeholder');
    if (!placeholder) return;

    const panelHTML = `
        <div id="hypothesis-generation-panel" class="mt-6 pt-6 border-t collapsible-section">
            <div class="flex justify-between items-center mb-4 collapsible-header cursor-pointer" data-interactive="true">
                <h3 class="text-xl font-semibold">Hypothesis Generation Methods</h3>
                <i class="fas fa-chevron-down text-gray-600 collapse-icon"></i>
            </div>
            
            <div class="collapsible-content">
                <nav class="mb-6 border-b border-gray-200">
                    <div class="-mb-px flex space-x-8" role="tablist">
                        <button 
                            id="tab-ai-agents" 
                            class="hypothesis-method-tab whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-blue-600 border-blue-600" 
                            data-tab="ai-agents"
                            role="tab"
                            aria-selected="true">
                            <i class="fas fa-robot mr-2"></i>Hypothesis Generation Via AI Agents
                        </button>
                        <button 
                            id="tab-heuristic" 
                            class="hypothesis-method-tab whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 border-transparent" 
                            data-tab="heuristic"
                            role="tab"
                            aria-selected="false">
                            <i class="fas fa-brain mr-2"></i>Hypothesis Generation Via Heuristic Algorithms
                        </button>
                    </div>
                </nav>
                
                <div id="tab-content-ai-agents" class="hypothesis-tab-content">
                    ${renderAIAgentsTab()}
                </div>

                <div id="tab-content-heuristic" class="hypothesis-tab-content hidden">
                    ${renderHeuristicAlgorithmsTab(isHypothesisReady, isComparisonSelected)}
                </div>
                
                <div class="flex justify-end items-center space-x-4 mt-6 bg-gray-50 p-4 rounded-lg">
                    <button id="generate-hypotheses-btn" class="font-bold py-2 px-4 rounded-lg transition duration-300 flex items-center bg-gray-300 text-gray-500 cursor-not-allowed" disabled>
                        <i class="fas fa-cogs mr-2"></i>Generate Hypotheses
                    </button>
                </div>
            </div>
        </div>

        <div id="hypothesis-results-area" class="mt-4">
            </div>

        <div id="ai-utilities-panel" class="mt-6 pt-6 border-t">
            <h3 class="text-xl font-semibold mb-4">AI-Powered Analysis</h3>
            <div class="bg-gray-50 p-4 rounded-lg">
                <div class="flex items-start justify-between space-x-4 mb-4">
                    <p class="text-sm text-gray-600 mt-1 flex-grow">
                        The AI will analyze the top 10 hypotheses from each category, along with any you manually select. It will provide a summary of key findings and suggest next steps for your analysis.
                    </p>
                    <button id="analyze-with-llm-btn" class="font-bold py-2 px-4 rounded-lg transition duration-300 flex items-center bg-gray-300 text-gray-500 cursor-not-allowed flex-shrink-0" disabled>
                        <i class="fas fa-magic mr-2"></i>Analyze with AI
                    </button>
                </div>
            </div>
        </div>`;
    
    placeholder.innerHTML = panelHTML;
    attachEventListeners(isHypothesisReady);
}

/**
 * Renders the Heuristic Algorithms tab content.
 */
function renderHeuristicAlgorithmsTab(isHypothesisReady, isComparisonSelected) {
    return `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="border rounded-lg p-4 flex flex-col">
                <h4 class="font-bold text-md mb-2">Greedy Beam Search (GBS)</h4>
                <p class="text-sm text-gray-600 flex-grow">A heuristic-based method that explores hypotheses level by level, continuously refining the best candidates found. It focuses on exploitation, guided by a composite quality score.</p>
                
                <div class="mt-4 space-y-2 text-sm">
                    <div>
                        <label for="gbs-max-complexity" class="font-medium text-gray-700">Max Complexity (Depth):</label>
                        <input type="number" id="gbs-max-complexity" value="3" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Max number of conditions in a hypothesis.</p>
                    </div>
                    <div>
                        <label for="gbs-beam-width" class="font-medium text-gray-700">Beam Width:</label>
                        <input type="number" id="gbs-beam-width" value="5" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Number of candidates to keep at each level.</p>
                    </div>
                </div>

                <div class="mt-4 flex items-center">
                    <input type="checkbox" id="gbs-checkbox" data-method="gbs" class="hypothesis-method-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                    <label for="gbs-checkbox" class="ml-2 block text-sm text-gray-900">Use this method</label>
                </div>
            </div>

            <div class="border rounded-lg p-4 flex flex-col">
                <h4 class="font-bold text-md mb-2">Deep Reinforcement Learning (DRL)</h4>
                <p class="text-sm text-gray-600 flex-grow">An agent learns an optimal policy for constructing hypotheses through trial-and-error. It balances exploration and exploitation dynamically by learning which sequences of actions lead to high-reward discoveries.</p>
                 <div class="mt-4 space-y-2 text-sm">
                    <div>
                        <label for="drl-num-generations" class="font-medium text-gray-700">Number of Generations:</label>
                        <input type="number" id="drl-num-generations" value="25" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Number of generations for the agent to evolve.</p>
                    </div>
                    <div>
                        <label for="drl-max-len" class="font-medium text-gray-700">Max Complexity (Depth):</label>
                        <input type="number" id="drl-max-len" value="3" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Max number of conditions in a hypothesis.</p>
                    </div>
                </div>
                 <div class="mt-4 flex items-center">
                    <input type="checkbox" id="drl-checkbox" data-method="drl" class="hypothesis-method-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                        <label for="drl-checkbox" class="ml-2 block text-sm text-gray-900">Use this method</label>
                </div>
            </div>

            <div class="border rounded-lg p-4 flex flex-col">
                <h4 class="font-bold text-md mb-2">Decision Trees (DT)</h4>
                <p class="text-sm text-gray-600 flex-grow">Recursively partitions the data to find subgroups. Multiple specialized trees are trained to find rules for high-mean, low-mean, and high-variance groups, which are then evaluated as hypotheses.</p>
                <div class="mt-4 space-y-2 text-sm">
                    <div>
                        <label for="dt-max-depth" class="font-medium text-gray-700">Max Complexity (Depth):</label>
                        <input type="number" id="dt-max-depth" value="3" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Max number of conditions in a hypothesis.</p>
                    </div>
                </div>
                 <div class="mt-4 flex items-center">
                    <input type="checkbox" id="dt-checkbox" data-method="dt" class="hypothesis-method-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                    <label for="dt-checkbox" class="ml-2 block text-sm text-gray-900">Use this method</label>
                </div>
            </div>

            <div class="border rounded-lg p-4 flex flex-col">
                <h4 class="font-bold text-md mb-2">Genetic Algorithm (GA)</h4>
                <p class="text-sm text-gray-600 flex-grow">A global optimization heuristic that evolves a "population" of hypotheses over generations using crossover and mutation to balance exploration and exploitation, finding diverse solutions.</p>
                 <div class="mt-4 space-y-2 text-sm">
                    <div>
                        <label for="ga-population-size" class="font-medium text-gray-700">Initial Population Size:</label>
                        <input type="number" id="ga-population-size" value="100" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Number of random hypotheses to start with.</p>
                    </div>
                     <div>
                        <label for="ga-num-generations" class="font-medium text-gray-700">Number of Generations:</label>
                        <input type="number" id="ga-num-generations" value="10" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">How many cycles the algorithm should evolve.</p>
                    </div>
                    <div>
                        <label for="ga-max-complexity" class="font-medium text-gray-700">Max Complexity (Depth):</label>
                        <input type="number" id="ga-max-complexity" value="3" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Max number of conditions in a hypothesis.</p>
                    </div>
                </div>
                 <div class="mt-4 flex items-center">
                    <input type="checkbox" id="ga-checkbox" data-method="ga" class="hypothesis-method-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                    <label for="ga-checkbox" class="ml-2 block text-sm text-gray-900">Use this method</label>
                </div>
            </div>

             <div class="border rounded-lg p-4 flex flex-col">
                <h4 class="font-bold text-md mb-2">Alpha-Investing (Alpha-I)</h4>
                <p class="text-sm text-gray-600 flex-grow">Adapts the greedy search to be more statistically rigorous by using a "significance budget" (alpha-wealth) to control the False Discovery Rate (FDR) during sequential testing.</p>
                 <div class="mt-4 space-y-2 text-sm">
                    <div>
                        <label for="alphai-lambda" class="font-medium text-gray-700">Diversity (λ):</label>
                        <input type="number" step="0.1" id="alphai-lambda" value="0.5" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Factor to balance coverage and diversity.</p>
                    </div>
                     <div>
                        <label for="alphai-ngroups" class="font-medium text-gray-700">Max Groups (n):</label>
                        <input type="number" id="alphai-ngroups" value="20" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Max number of significant groups to find.</p>
                    </div>
                     <div>
                        <label for="alphai-wealth" class="font-medium text-gray-700">Initial α-Wealth:</label>
                        <input type="number" step="0.1" id="alphai-wealth" value="0.5" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Initial budget for statistical testing.</p>
                    </div>
                     <div>
                        <label for="alphai-gamma" class="font-medium text-gray-700">Cost Factor (γ):</label>
                        <input type="number" step="0.1" id="alphai-gamma" value="1.0" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Base cost factor for testing a hypothesis.</p>
                    </div>
                     <div>
                        <label for="alphai-alpha" class="font-medium text-gray-700">Gain on Acceptance (α):</label>
                        <input type="number" step="0.1" id="alphai-alpha" value="0.1" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Wealth gained when a hypothesis is accepted.</p>
                    </div>
                     <div>
                        <label for="alphai-max-depth" class="font-medium text-gray-700">Max Complexity (Depth):</label>
                        <input type="number" id="alphai-max-depth" value="3" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                        <p class="mt-1 text-xs text-gray-500">Max number of conditions in a hypothesis.</p>
                    </div>
                </div>
                 <div class="mt-4 flex items-center">
                    <input type="checkbox" id="alphai-checkbox" data-method="alpha_i" class="hypothesis-method-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                    <label for="alphai-checkbox" class="ml-2 block text-sm text-gray-900">Use this method</label>
                </div>
            </div>

            <div class="border rounded-lg p-4 flex flex-col ${!isComparisonSelected ? 'bg-gray-100 opacity-60' : ''}">
                <h4 class="font-bold text-md mb-2">Compare Groups</h4>
                <p class="text-sm text-gray-600 flex-grow">Compares two distinct groups within a single column using Welch's t-test to find significant differences in the target variable's mean or variance. Requires a comparison column to be selected.</p>
                <div class="flex-grow"></div>
                <div class="mt-4 flex items-center">
                    <input type="checkbox" id="two_sample-checkbox" data-method="two_sample" class="hypothesis-method-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" ${!isComparisonSelected ? 'disabled' : ''}>
                    <label for="two_sample-checkbox" class="ml-2 block text-sm text-gray-900">Use this method</label>
                </div>
            </div>
        </div>
    `;
}

/**
 * Renders the AI Agents tab content.
 */
function renderAIAgentsTab() {
    return `
        <div class="border rounded-lg p-6 bg-gradient-to-br from-purple-50 to-blue-50">
            <div class="flex items-center mb-4">
                <div class="bg-white p-3 rounded-full shadow-sm mr-4">
                    <i class="fas fa-robot text-3xl text-purple-500"></i>
                </div>
                <div>
                    <h3 class="text-2xl font-bold text-gray-800">Autonomous AI Exploration</h3>
                    <p class="text-gray-600 text-sm">
                        Tell the AI agent what kind of insights you are looking for. It will autonomously analyze the data and generate hypotheses based on your goal.
                    </p>
                </div>
            </div>

            <div class="mt-6 bg-white p-5 rounded-lg border shadow-sm">
                <label for="ai-agent-prompt" class="block text-md font-semibold text-gray-700 mb-2">
                    What do you need from this dataset?
                </label>
                <textarea id="ai-agent-prompt" rows="3" 
                    class="w-full p-3 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500" 
                    placeholder="Example: 'I want to understand what combinations of factors lead to a higher than average body mass.'"></textarea>
                
                <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm bg-gray-50 p-4 rounded-lg border border-gray-200">
                    
                    <div class="md:col-span-3 flex items-center space-x-6 pb-2 border-b border-gray-200">
                        <span class="font-semibold text-gray-700">AI Provider:</span>
                        <label class="inline-flex items-center cursor-pointer">
                            <input type="radio" name="ai-provider" value="OpenAI" checked class="form-radio text-purple-600 focus:ring-purple-500 h-4 w-4">
                            <span class="ml-2">OpenAI</span>
                        </label>
                        <label class="inline-flex items-center cursor-pointer">
                            <input type="radio" name="ai-provider" value="Groq" class="form-radio text-purple-600 focus:ring-purple-500 h-4 w-4">
                            <span class="ml-2">Groq</span>
                        </label>
                    </div>

                    <div class="md:col-span-3">
                        <label for="ai-agent-api-key" class="font-semibold text-gray-700">API Key:</label>
                        <input type="text" id="ai-agent-api-key" value="" placeholder="Paste your OpenAI API key" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm">
                    </div>

                    <div class="md:col-span-3">
                        <div id="ai-provider-status" class="text-xs text-gray-600"></div>
                    </div>

                    <div>
                        <label for="ai-agent-model" class="font-semibold text-gray-700">Model Name:</label>
                        <input type="text" id="ai-agent-model" value="gpt-5.4-mini" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm">
                    </div>
                    <div>
                        <label for="ai-agent-temperature" class="font-semibold text-gray-700">Temperature:</label>
                        <input type="number" step="0.1" id="ai-agent-temperature" value="0.5" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm">
                    </div>
                    <div>
                        <label for="ai-agent-iterations" class="font-semibold text-gray-700">Total Iterations:</label>
                        <input type="number" id="ai-agent-iterations" value="3" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm">
                    </div>
                    <div>
                        <label for="ai-agent-min-hyp" class="font-semibold text-gray-700">Min Hypotheses / Run:</label>
                        <input type="number" id="ai-agent-min-hyp" value="5" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm">
                    </div>
                </div>

                <div class="mt-6 flex items-center bg-purple-100 p-3 rounded-md">
                    <input type="checkbox" id="ai-agent-checkbox" data-method="ai_agent" class="hypothesis-method-checkbox h-5 w-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer">
                    <label for="ai-agent-checkbox" class="ml-3 block text-md font-bold text-purple-900 cursor-pointer">
                        Enable AI Agent Generation
                    </label>
                </div>
            </div>
        </div>
    `;
}

/**
 * Fallback local para atualizar a UI do provider caso o outro arquivo não esteja ativo.
 */
function applyLocalProviderUIState() {
    const provider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'OpenAI';
    const modelInput = document.getElementById('ai-agent-model');
    const keyInput = document.getElementById('ai-agent-api-key');
    const statusEl = document.getElementById('ai-provider-status');

    if (!modelInput || !keyInput) return;

    if (provider === 'OpenAI') {
        modelInput.value = 'gpt-5.4-mini';
        keyInput.placeholder = 'Paste your OpenAI API key';
        if (statusEl && !statusEl.textContent.trim()) {
            statusEl.textContent = 'OpenAI selected.';
        }
    } else {
        modelInput.value = 'llama-3.3-70b-versatile';
        keyInput.placeholder = 'Paste your Groq API key';
        if (statusEl && !statusEl.textContent.trim()) {
            statusEl.textContent = 'Groq selected.';
        }
    }

    keyInput.value = '';
}

/**
 * Attaches all event listeners for the hypothesis panel.
 */
function attachEventListeners(isHypothesisReady) {
    document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (typeof updateAIProviderUIState === 'function') {
                updateAIProviderUIState();
            } else {
                applyLocalProviderUIState();
            }
        });
    });

    if (typeof initAIProviderUI === 'function') {
        initAIProviderUI();
    } else {
        applyLocalProviderUIState();
    }

    // Tab switching
    document.querySelectorAll('.hypothesis-method-tab').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.tab;
            
            document.querySelectorAll('.hypothesis-method-tab').forEach(btn => {
                btn.classList.remove('text-blue-600', 'border-blue-600');
                btn.classList.add('text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300', 'border-transparent');
                btn.setAttribute('aria-selected', 'false');
            });
            button.classList.add('text-blue-600', 'border-blue-600');
            button.classList.remove('text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
            button.setAttribute('aria-selected', 'true');
            
            document.querySelectorAll('.hypothesis-tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            
            const selectedContent = document.getElementById(`tab-content-${tabId}`);
            selectedContent.classList.remove('hidden');
            
            const parentCollapsible = selectedContent.closest('.collapsible-content');
            if (parentCollapsible && parentCollapsible.classList.contains('expanded')) {
                parentCollapsible.style.maxHeight = 'none'; 
                
                setTimeout(() => {
                    parentCollapsible.style.maxHeight = parentCollapsible.scrollHeight + "px";
                }, 50);
            }
        });
    });

    const generateBtn = document.getElementById('generate-hypotheses-btn');
    const analyzeBtn = document.getElementById('analyze-with-llm-btn');
    const checkboxes = document.querySelectorAll('.hypothesis-method-checkbox');

    function updateButtonStates() {
        const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
        const resultsReady = window.hypothesesApp && window.hypothesesApp.sortedHypotheses && window.hypothesesApp.sortedHypotheses.length > 0;

        if (anyChecked && isHypothesisReady) {
            generateBtn.disabled = false;
            generateBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
            generateBtn.classList.add('bg-green-600', 'text-white', 'hover:bg-green-700');
        } else {
            generateBtn.disabled = true;
            generateBtn.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
            generateBtn.classList.remove('bg-green-600', 'text-white', 'hover:bg-green-700');
        }

        if (resultsReady) {
            analyzeBtn.disabled = false;
            analyzeBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
            analyzeBtn.classList.add('bg-blue-600', 'text-white', 'hover:bg-blue-700');
        } else {
            analyzeBtn.disabled = true;
            analyzeBtn.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
            analyzeBtn.classList.remove('bg-blue-600', 'text-white', 'hover:bg-blue-700');
        }
    }

    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', updateButtonStates);
    });

    generateBtn?.addEventListener('click', () => {
        const selectedMethods = {};
        checkboxes.forEach(cb => {
            if (cb.checked) {
                const method = cb.dataset.method;
                selectedMethods[method] = {};

                if (method === 'gbs') {
                    selectedMethods[method].max_complexity = parseInt(document.getElementById('gbs-max-complexity').value, 10) || 3;
                    selectedMethods[method].beam_width = parseInt(document.getElementById('gbs-beam-width').value, 10) || 5;
                }
                if (method === 'alpha_i') {
                    selectedMethods[method].lambda_val = parseFloat(document.getElementById('alphai-lambda').value) || 0.5;
                    selectedMethods[method].n_groups = parseInt(document.getElementById('alphai-ngroups').value, 10) || 20;
                    selectedMethods[method].initial_alpha_wealth = parseFloat(document.getElementById('alphai-wealth').value) || 0.5;
                    selectedMethods[method].gamma = parseFloat(document.getElementById('alphai-gamma').value) || 1.0;
                    selectedMethods[method].alpha = parseFloat(document.getElementById('alphai-alpha').value) || 0.1;
                    selectedMethods[method].max_depth = parseInt(document.getElementById('alphai-max-depth').value, 10) || 3;
                }
                if (method === 'dt') {
                    selectedMethods[method].max_depth = parseInt(document.getElementById('dt-max-depth').value, 10) || 3;
                }
                if (method === 'ga') {
                    selectedMethods[method].max_complexity = parseInt(document.getElementById('ga-max-complexity').value, 10) || 3;
                    selectedMethods[method].population_size = parseInt(document.getElementById('ga-population-size').value, 10) || 100;
                    selectedMethods[method].num_generations = parseInt(document.getElementById('ga-num-generations').value, 10) || 10;
                }
                if (method === 'drl') {
                    selectedMethods[method].num_generations = parseInt(document.getElementById('drl-num-generations').value, 10) || 25;
                    selectedMethods[method].max_len = parseInt(document.getElementById('drl-max-len').value, 10) || 3;
                }

                if (method === 'ai_agent') {
                    const agentPrompt = document.getElementById('ai-agent-prompt').value.trim();
                    const selectedProvider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'OpenAI';
                    const apiKeyInput = document.getElementById('ai-agent-api-key');
                    const modelInput = document.getElementById('ai-agent-model');

                    selectedMethods[method].prompt = agentPrompt;
                    selectedMethods[method].provider = selectedProvider;
                    selectedMethods[method].api_key = apiKeyInput?.disabled ? '' : (apiKeyInput?.value.trim() || '');
                    selectedMethods[method].model_name = modelInput?.value.trim() || (selectedProvider === 'OpenAI' ? 'gpt-5.4-mini' : 'llama-3.3-70b-versatile');
                    selectedMethods[method].temperature = parseFloat(document.getElementById('ai-agent-temperature').value) || 0.2;
                    selectedMethods[method].total_iterations = parseInt(document.getElementById('ai-agent-iterations').value, 10) || 2;
                    selectedMethods[method].min_hypotheses_per_run = parseInt(document.getElementById('ai-agent-min-hyp').value, 10) || 3;

                    if (agentPrompt) {
                        const descBox = document.getElementById('dataset-description');
                        if (descBox) {
                            let currentDesc = descBox.value.trim();
                            if (!currentDesc.includes(agentPrompt)) {
                                const intentText = `User Intent for AI Exploration: ${agentPrompt}`;
                                descBox.value = currentDesc ? `${currentDesc}\n\n${intentText}` : intentText;
                                if (window.ShevaCore && window.ShevaCore.state) {
                                    window.ShevaCore.state.datasetDescriptionText = descBox.value;
                                }
                            }
                        }
                    }
                }
            }
        });

        if (window.hypothesesApp && typeof window.hypothesesApp.generateHypotheses === 'function') {
            window.hypothesesApp.generateHypotheses(selectedMethods);
        } else {
            console.error("generateHypotheses function not found.");
        }
    });

    analyzeBtn?.addEventListener('click', handleAIAnalysis);
    updateButtonStates();
}

// --- ADDITIONAL UTILITY FUNCTIONS ---

/**
 * Normalizes a matrix using min-max scaling to a [0, 1] range.
 * @param {Array<Array<number>>} matrix - The data matrix.
 * @returns {Array<Array<number>>} The normalized matrix.
 */
function normalizeMatrix(matrix) {
    if (!matrix || matrix.length === 0) return [];
    const numCols = matrix[0].length;
    const min = Array(numCols).fill(Infinity);
    const max = Array(numCols).fill(-Infinity);

    for (const row of matrix) {
        for (let j = 0; j < numCols; j++) {
            if (row[j] < min[j]) min[j] = row[j];
            if (row[j] > max[j]) max[j] = row[j];
        }
    }

    const range = max.map((val, i) => val - min[i]);
    return matrix.map(row => {
        return row.map((val, j) => {
            return range[j] > 0 ? (val - min[j]) / range[j] : 0.5;
        });
    });
}

/**
 * Reduces hypothesis data to 2D using t-SNE.
 * @param {Array<Object>} numericalData - Numerical hypothesis data.
 * @returns {Promise<Array<Object>|null>} Data with added t-SNE coordinates, or null on error.
 */
async function reduceHypothesesWithTSNE(numericalData) {
    if (typeof tsnejs === 'undefined' || typeof tsnejs.tSNE === 'undefined') {
        console.error("t-SNE.js library not found or not loaded correctly. Please check the script tag and loading order in your main HTML file.");
        showModal("Error: t-SNE library not found.");
        return null;
    }
    if (!numericalData || numericalData.length === 0) return null;

    const headersToProcess = Object.keys(numericalData[0]).filter(h => h !== 'Hypothesis_Text' && h !== 'Method');
    let matrix = numericalData.map(row => {
        return headersToProcess.map(header => parseFloat(row[header]) || 0);
    });

    const normalizedMatrix = normalizeMatrix(matrix);

    const model = new tsnejs.tSNE({
        dim: 2,
        perplexity: 20.0,
        epsilon: 10
    });

    model.initDataRaw(normalizedMatrix);

    const iterations = 500;
    for (let k = 0; k < iterations; k++) {
        model.step();
    }

    const output = model.getSolution();

    const finalData = numericalData.map((row, i) => ({
        'Hypothesis_Text': row['Hypothesis_Text'],
        'Score': parseFloat(row['Score']),
        'q-Value': parseFloat(row['q-Value']),
        'Impact': parseFloat(row['Impact']),
        'Coverage': parseFloat(row['Coverage']),
        'Diversity': parseFloat(row['Diversity']),
        'Homogeneity': parseFloat(row['Homogeneity']),
        'tsne_x': output[i][0],
        'tsne_y': output[i][1]
    }));

    return finalData;
}

/**
 * Creates a numerical table from hypotheses using one-hot encoding.
 * @returns {Array<Object>|null} A numerical representation of hypotheses, or null.
 */
function generateNumericalTableData() {
    const { sortedHypotheses } = window.hypothesesApp;

    if (!sortedHypotheses || sortedHypotheses.length === 0) {
        console.error("Hypotheses data not available to generate numerical table.");
        return null;
    }

    const methodMap = { 'ga': 0.2, 'dt': 0.4, 'gbs': 0.6, 'alpha_i': 0.8, 'drl': 1.0, 'ai agent': 1.2, 'ai_agent': 1.2 };

    const allAttributePairs = new Set();
    sortedHypotheses.forEach(hyp => {
        const attributes = extractAttributesFromHypothesis(hyp.Hypothesis_Text);
        attributes.forEach(attr => {
            allAttributePairs.add(`${attr.attribute} = '${attr.value}'`);
        });
    });
    const featureColumns = Array.from(allAttributePairs).sort();

    const numericalData = sortedHypotheses.map(hyp => {
        const row = {};

        row['Hypothesis_Text'] = hyp.Hypothesis_Text;
        row['Score'] = hyp.Fitness_Score !== null ? hyp.Fitness_Score : 0;
        row['q-Value'] = hyp.Significance_qValue !== null ? hyp.Significance_qValue : 0;
        row['Impact'] = hyp.Impact_Lift !== null ? hyp.Impact_Lift : 0;
        row['Coverage'] = hyp.Coverage !== null ? hyp.Coverage : 0;
        row['Diversity'] = hyp.Diversity !== null ? hyp.Diversity : 0;
        row['Homogeneity'] = hyp.Homogeneity !== null ? hyp.Homogeneity : NaN;
        
        const methodName = hyp.source_method?.toLowerCase() || '';
        row['Method'] = methodMap[methodName] || 0;

        const currentHypothesisAttributes = new Set();
        const attributes = extractAttributesFromHypothesis(hyp.Hypothesis_Text);
        attributes.forEach(attr => {
            currentHypothesisAttributes.add(`${attr.attribute} = '${attr.value}'`);
        });

        featureColumns.forEach(featureName => {
            row[featureName] = currentHypothesisAttributes.has(featureName) ? 1 : 0;
        });

        return row;
    });

    return numericalData;
}

/**
 * Main function to set up and render all hypothesis visualizations.
 * @param {Array} hypotheses - Hypothesis data from the backend.
 * @param {string} sunburstJson - JSON for the Plotly sunburst figure.
 * @param {Object} newTargetInfo - Info for the target column (name, mean, variance).
 * @param {Object} tableData - The full dataset (headers and rows).
 */
function setupAndRenderHypotheses(hypotheses, sunburstJson, newTargetInfo, tableData) {
    if (newTargetInfo) {
        targetInfo = newTargetInfo;
    }

    const sortedHypotheses = calculateAndSortByFitnessScore(hypotheses);
    
    window.hypothesesApp.sortedHypotheses = sortedHypotheses;
    window.hypothesesApp.fullDataset = tableData;

    categorizedHypotheses = {
        'greater than': sortedHypotheses.filter(h => h.Operator === 'greater than'),
        'less than': sortedHypotheses.filter(h => h.Operator === 'less than'),
        'variance is higher': sortedHypotheses.filter(h => h.Operator === 'variance is higher')
    };
    
    window.hypothesesApp.categorizedHypotheses = categorizedHypotheses;

    displayCounts = {
        'greater than': 1,
        'less than': 1,
        'variance is higher': 1
    };

    drawHypothesisTables();
    renderSunburstCharts(sortedHypotheses);
    renderHypothesisTree(sortedHypotheses);
    renderTSNE(sortedHypotheses);
    renderHeatmap(sortedHypotheses);
    renderMetrics(sortedHypotheses);

    const analyzeBtn = document.getElementById('analyze-with-llm-btn');
    if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
        analyzeBtn.classList.add('bg-blue-600', 'text-white', 'hover:bg-blue-700');
    }
}