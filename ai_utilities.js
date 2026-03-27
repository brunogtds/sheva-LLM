// --- AI UTILITIES ---
// Handles interaction with the local Python backend for LLM communication.

// Stores the conversation history with the AI.
let chatHistory = [];

let aiRoundCounter = 1;
let currentAnalysisSections = {
    narrator: '',
    nextSteps: ''
};

let availableLLMProviders = {
    OpenAI: { has_env_key: false, default_model: 'gpt-5.4-mini' },
    Groq: { has_env_key: false, default_model: 'llama-3.3-70b-versatile' }
};

function showGenerationRoundBanner(roundNumber) {
    const panel = document.getElementById('hypothesis-generation-panel');
    if (!panel) return;

    let banner = document.getElementById('generation-round-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'generation-round-banner';
        banner.className = 'mb-4 p-3 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 font-medium';
        panel.prepend(banner);
    }

    banner.innerHTML = `
        <div class="flex items-center justify-between">
            <span>Generating hypothesis round ${roundNumber}</span>
            <span class="text-xs bg-indigo-100 px-2 py-1 rounded-full">
                Triggered by Next-Step Agent
            </span>
        </div>
    `;
}

/**
 * Escapa HTML simples para evitar quebrar a UI.
 */
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Converte markdown simples em HTML.
 */
function formatSimpleMarkdown(text = '') {
    return escapeHtml(text)
        .replace(/^###\s+(.+)/gm, '<h4 class="text-lg font-semibold mt-4 mb-2">$1</h4>')
        .replace(/^##\s+(.+)/gm, '<h3 class="text-xl font-semibold mt-4 mb-2">$1</h3>')
        .replace(/^#\s+(.+)/gm, '<h2 class="text-2xl font-bold mt-4 mb-2">$1</h2>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/gs, '<ul class="list-disc pl-5 space-y-1">$1</ul>')
        .replace(/\n/g, '<br>');
}

/**
 * Tenta separar a resposta da IA em Narrator Agent e Next-Step Agent.
 */
function parseAgentSections(aiText = '') {
    const narratorRegex = /###\s*Narrator Agent\s*([\s\S]*?)(?=###\s*Next-Step Agent|$)/i;
    const nextStepsRegex = /###\s*Next-Step Agent\s*([\s\S]*)$/i;

    const narratorMatch = aiText.match(narratorRegex);
    const nextStepsMatch = aiText.match(nextStepsRegex);

    const narrator = narratorMatch ? narratorMatch[1].trim() : aiText.trim();
    const nextSteps = nextStepsMatch ? nextStepsMatch[1].trim() : '';

    return { narrator, nextSteps };
}

/**
 * Renderiza a resposta da IA em cards separados.
 */
function renderStructuredAIResponse(aiText, isFirstResponse = false) {
    const chatBox = document.getElementById('ai-chat-messages');
    if (!chatBox) return;

    const { narrator, nextSteps } = parseAgentSections(aiText);
    currentAnalysisSections = { narrator, nextSteps };

    const wrapper = document.createElement('div');
    wrapper.className = 'mt-4 space-y-4';

    const narratorCard = document.createElement('div');
    narratorCard.className = 'border border-blue-200 bg-blue-50 rounded-xl p-4 shadow-sm';
    narratorCard.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <p class="font-semibold text-blue-900 text-lg">Narrator Agent</p>
            <span class="text-xs font-medium bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                Round ${aiRoundCounter}
            </span>
        </div>
        <div class="prose prose-sm max-w-none text-gray-800">
            ${formatSimpleMarkdown(narrator || 'No narrator analysis returned.')}
        </div>
    `;
    wrapper.appendChild(narratorCard);

    if (nextSteps && nextSteps.trim()) {
        const nextStepsCard = document.createElement('div');
        nextStepsCard.className = 'border border-purple-200 bg-purple-50 rounded-xl p-4 shadow-sm';
        nextStepsCard.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <p class="font-semibold text-purple-900 text-lg">Next-Step Agent</p>
                <span class="text-xs font-medium bg-purple-100 text-purple-800 px-2 py-1 rounded-full">
                    Suggested next round
                </span>
            </div>
            <div class="prose prose-sm max-w-none text-gray-800">
                ${formatSimpleMarkdown(nextSteps)}
            </div>
        `;
        wrapper.appendChild(nextStepsCard);

        if (isFirstResponse) {
            const actionBtnDiv = document.createElement('div');
            actionBtnDiv.className = 'mt-2 p-4 bg-white border border-purple-200 rounded-xl flex flex-col items-center text-center shadow-sm';
            actionBtnDiv.innerHTML = `
                <p class="text-sm text-purple-800 mb-3">
                    Do you want to generate a new round based only on the Next-Step Agent suggestions?
                </p>
                <button id="run-suggested-agent-btn" class="bg-purple-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-purple-700 shadow-md transition duration-300 flex items-center">
                    <i class="fas fa-robot text-xl mr-3"></i> Run AI Agent with Next-Step Suggestions
                </button>
            `;
            wrapper.appendChild(actionBtnDiv);

            setTimeout(() => {
                document.getElementById('run-suggested-agent-btn')?.addEventListener('click', handleRunSuggestedNextSteps);
            }, 0);
        }
    }

    const aiMessageDiv = document.createElement('div');
    aiMessageDiv.className = 'mt-4';
    aiMessageDiv.innerHTML = `<p class="font-semibold mb-2">AI</p>`;
    aiMessageDiv.appendChild(wrapper);

    chatBox.appendChild(aiMessageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * Adiciona uma mensagem visual informando que uma nova rodada foi disparada.
 */
function appendRoundStatusMessage(roundNumber, nextStepsText) {
    const chatBox = document.getElementById('ai-chat-messages');
    if (!chatBox) return;

    const statusDiv = document.createElement('div');
    statusDiv.className = 'mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4 shadow-sm';
    statusDiv.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <p class="font-semibold text-amber-900">New Hypothesis Round Triggered</p>
            <span class="text-xs font-medium bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                Round ${roundNumber}
            </span>
        </div>
        <p class="text-sm text-amber-800 mb-2">
            The system is generating a new hypothesis round based on the Next-Step Agent suggestions.
        </p>
        <details class="text-sm text-gray-700">
            <summary class="cursor-pointer font-medium">Show Next-Step text used</summary>
            <div class="mt-2 whitespace-pre-wrap">${escapeHtml(nextStepsText)}</div>
        </details>
    `;
    chatBox.appendChild(statusDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * Provider helpers
 */
function getSelectedAIProvider() {
    const radio = document.querySelector('input[name="ai-provider"]:checked');
    if (radio?.value) return radio.value;

    const select = document.getElementById('ai-provider');
    if (select?.value) return select.value;

    return 'OpenAI';
}

function getDefaultModelForProvider(provider) {
    return availableLLMProviders?.[provider]?.default_model ||
        (provider === 'OpenAI' ? 'gpt-5.4-mini' : 'llama-3.3-70b-versatile');
}

function getAIProviderInputs() {
    return {
        apiKeyInput: document.getElementById('ai-agent-api-key'),
        modelInput: document.getElementById('ai-agent-model'),
        providerSelect: document.getElementById('ai-provider'),
        providerRadios: document.querySelectorAll('input[name="ai-provider"]')
    };
}

function findApiKeyContainer(apiKeyInput) {
    if (!apiKeyInput) return null;

    return (
        apiKeyInput.closest('.form-group') ||
        apiKeyInput.closest('.field-group') ||
        apiKeyInput.closest('.control-group') ||
        apiKeyInput.closest('.mb-3') ||
        apiKeyInput.closest('.mb-4') ||
        apiKeyInput.parentElement
    );
}

function findMaxRepairContainer() {
    const input = document.getElementById('ai-agent-max-repair');
    if (!input) return null;

    return (
        input.closest('.form-group') ||
        input.closest('.field-group') ||
        input.closest('.control-group') ||
        input.closest('.mb-3') ||
        input.closest('.mb-4') ||
        input.parentElement
    );
}

function ensureProviderStatusElement() {
    let statusEl = document.getElementById('ai-provider-status');
    if (statusEl) return statusEl;

    const { apiKeyInput, modelInput } = getAIProviderInputs();
    const anchor = apiKeyInput || modelInput;
    if (!anchor || !anchor.parentElement) return null;

    statusEl = document.createElement('div');
    statusEl.id = 'ai-provider-status';
    statusEl.className = 'mt-2 text-xs text-gray-600';
    anchor.parentElement.appendChild(statusEl);
    return statusEl;
}

function updateAIProviderUIState() {
    const provider = getSelectedAIProvider();
    const providerInfo = availableLLMProviders?.[provider] || {};
    const hasEnvKey = !!providerInfo.has_env_key;

    const { apiKeyInput, modelInput } = getAIProviderInputs();
    const apiKeyContainer = findApiKeyContainer(apiKeyInput);
    const maxRepairContainer = findMaxRepairContainer();
    const statusEl = ensureProviderStatusElement();

    if (maxRepairContainer) {
        maxRepairContainer.style.display = 'none';
    }

    if (modelInput && (!modelInput.value || modelInput.dataset.autofilled !== 'false')) {
        modelInput.value = getDefaultModelForProvider(provider);
        modelInput.dataset.autofilled = 'true';
    }

    if (apiKeyInput) {
        if (hasEnvKey) {
            apiKeyInput.value = '';
            apiKeyInput.placeholder = `${provider} key loaded from environment`;
            apiKeyInput.required = false;
            apiKeyInput.disabled = true;
        } else {
            apiKeyInput.disabled = false;
            apiKeyInput.required = false;
            apiKeyInput.placeholder = `Paste your ${provider} API key`;
        }
    }

    if (apiKeyContainer) {
        apiKeyContainer.style.display = hasEnvKey ? 'none' : '';
    }

    if (statusEl) {
        statusEl.textContent = hasEnvKey
            ? `${provider} is ready. API key found in environment.`
            : `${provider} has no key in environment. Paste an API key to use it.`;
    }
}

async function loadLLMProvidersFromBackend() {
    try {
        const response = await fetch('http://localhost:8000/available_llm_providers');
        if (!response.ok) {
            throw new Error(`Failed to load providers: ${response.status}`);
        }

        const data = await response.json();
        if (data && typeof data === 'object') {
            availableLLMProviders = data;
        }
    } catch (error) {
        console.warn('Could not load /available_llm_providers. Falling back to local defaults.', error);
    } finally {
        enforceOpenAIDefaultSelection();
        updateAIProviderUIState();
    }
}

function enforceOpenAIDefaultSelection() {
    const { providerSelect, providerRadios } = getAIProviderInputs();

    if (providerSelect) {
        providerSelect.value = 'OpenAI';
    }

    if (providerRadios && providerRadios.length > 0) {
        providerRadios.forEach(radio => {
            radio.checked = (radio.value === 'OpenAI');
        });
    }
}

function initAIProviderUI() {
    const { providerSelect, providerRadios, modelInput } = getAIProviderInputs();

    if (providerSelect) {
        providerSelect.value = 'OpenAI';
        providerSelect.addEventListener('change', updateAIProviderUIState);
    }

    if (providerRadios && providerRadios.length > 0) {
        providerRadios.forEach(radio => {
            radio.checked = (radio.value === 'OpenAI');
            radio.addEventListener('change', updateAIProviderUIState);
        });
    }

    if (modelInput) {
        modelInput.value = getDefaultModelForProvider('OpenAI');
        modelInput.addEventListener('input', () => {
            modelInput.dataset.autofilled = 'false';
        });
    }

    const maxRepairContainer = findMaxRepairContainer();
    if (maxRepairContainer) {
        maxRepairContainer.style.display = 'none';
    }

    loadLLMProvidersFromBackend();
}

/**
 * Executa uma nova rodada usando apenas o texto do Next-Step Agent.
 */
function handleRunSuggestedNextSteps() {
    const chatBox = document.getElementById('ai-chat-messages');
    const nextStepsText = currentAnalysisSections.nextSteps?.trim();

    if (!nextStepsText) {
        showModal("Error: No Next-Step Agent suggestions were found.");
        return;
    }

    const originalIntent =
        window.hypothesesApp.userDescription ||
        document.getElementById('dataset-description')?.value ||
        "Explore the dataset to find significant patterns.";

    const combinedPrompt = `
Original user intent:
${originalIntent}

Next-Step Agent suggestions to be explicitly converted into NEW candidate rules/hypotheses:
"""
${nextStepsText}
"""

Please act as the Autonomous AI Agent.
Generate NEW hypotheses/rules directly grounded in the Next-Step suggestions above.
Prefer concrete, testable subgroup rules.
Do not repeat old hypotheses unless they are necessary refinements.
`.trim();

    const agentPromptInput = document.getElementById('ai-agent-prompt');
    if (agentPromptInput) {
        agentPromptInput.value = combinedPrompt;
    }

    const aiAgentCheckbox = document.getElementById('ai-agent-checkbox');
    if (aiAgentCheckbox) {
        aiAgentCheckbox.checked = true;
    }

    const feedbackDiv = document.createElement('div');
    feedbackDiv.className = 'text-right mt-4';
    feedbackDiv.innerHTML = `
        <p class="font-semibold">You</p>
        <p class="text-purple-600 italic">
            Running a new round using only the Next-Step Agent suggestions...
        </p>
    `;
    if (chatBox) {
        chatBox.appendChild(feedbackDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    aiRoundCounter += 1;
    appendRoundStatusMessage(aiRoundCounter, nextStepsText);
    showGenerationRoundBanner(aiRoundCounter);

    const btn = document.getElementById('run-suggested-agent-btn');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    if (window.hypothesesApp && typeof window.hypothesesApp.generateHypotheses === 'function') {
        const provider = getSelectedAIProvider();

        window.hypothesesApp.generateHypotheses({
            ai_agent: {
                prompt: combinedPrompt,
                provider: provider,
                api_key: document.getElementById('ai-agent-api-key')?.disabled
                    ? ""
                    : (document.getElementById('ai-agent-api-key')?.value.trim() || ""),
                model_name: document.getElementById('ai-agent-model')?.value.trim() || getDefaultModelForProvider(provider),
                temperature: parseFloat(document.getElementById('ai-agent-temperature')?.value) || 0.5,
                total_iterations: parseInt(document.getElementById('ai-agent-iterations')?.value, 10) || 3,
                min_hypotheses_per_run: parseInt(document.getElementById('ai-agent-min-hyp')?.value, 10) || 5
            }
        }, true);

        showModal(`Round ${aiRoundCounter} started from Next-Step suggestions.`);
    } else {
        showModal("Error: Hypothesis generation engine not found.");
    }
}

/**
 * Displays a non-blocking message modal.
 * @param {string} message The message to show.
 */
function showModal(message) {
    let existingModal = document.getElementById('feedback-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'feedback-modal';
    modal.style.position = 'fixed';
    modal.style.top = '20px';
    modal.style.left = '50%';
    modal.style.transform = 'translateX(-50%)';
    modal.style.backgroundColor = '#2d3748';
    modal.style.color = 'white';
    modal.style.padding = '16px 24px';
    modal.style.borderRadius = '8px';
    modal.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
    modal.style.zIndex = '1000';
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.3s ease, top 0.3s ease';
    modal.innerHTML = `<p>${escapeHtml(message)}</p>`;
    document.body.appendChild(modal);

    setTimeout(() => {
        modal.style.opacity = '1';
        modal.style.top = '40px';
    }, 10);

    setTimeout(() => {
        modal.style.opacity = '0';
        modal.style.top = '20px';
        setTimeout(() => modal.remove(), 300);
    }, 4000);
}

// --- NEW HELPER FUNCTIONS for statistics ---
function calculateMedian(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateSkewness(arr, mean, stdDev) {
    if (stdDev === 0) return 0;
    const n = arr.length;
    return (1 / n) * arr.reduce((sum, val) => sum + Math.pow((val - mean) / stdDev, 3), 0);
}

function calculateKurtosis(arr, mean, stdDev) {
    if (stdDev === 0) return 0;
    const n = arr.length;
    return (1 / n) * arr.reduce((sum, val) => sum + Math.pow((val - mean) / stdDev, 4), 0) - 3;
}

function calculateCorrelation(arr1, arr2) {
    let n = Math.min(arr1.length, arr2.length);
    if (n < 2) return 0;

    const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
    const mean2 = arr2.reduce((a, b) => a + b, 0) / n;
    const stdDev1 = Math.sqrt(arr1.reduce((sum, val) => sum + Math.pow(val - mean1, 2), 0) / n);
    const stdDev2 = Math.sqrt(arr2.reduce((sum, val) => sum + Math.pow(val - mean2, 2), 0) / n);

    if (stdDev1 === 0 || stdDev2 === 0) return 0;

    let covariance = 0;
    for (let i = 0; i < n; i++) {
        covariance += (arr1[i] - mean1) * (arr2[i] - mean2);
    }
    covariance /= n;

    return covariance / (stdDev1 * stdDev2);
}

/**
 * Builds the complete LLM prompt string from dataset stats and hypotheses.
 * @returns {string} The formatted prompt for the LLM.
 */
function buildLLMPrompt() {
    const { fullDataset, categorizedHypotheses, targetColumnIndex, userDescription, targetInfo } = window.hypothesesApp;

    if (!fullDataset || !categorizedHypotheses || !targetInfo) {
        console.error("buildLLMPrompt Error: One or more required objects (fullDataset, categorizedHypotheses, targetInfo) are missing from window.hypothesesApp.");
        return "Error: Dataset, hypotheses, or target info not available.";
    }

    if (typeof targetColumnIndex !== 'number' || targetColumnIndex < 0 || targetColumnIndex >= fullDataset.headers.length) {
        const errorMessage = "Error: A target variable has not been correctly selected or is invalid.";
        console.error(errorMessage, "Received index:", targetColumnIndex);
        showModal(errorMessage);
        return "Error: Invalid target column index provided. Cannot generate analysis.";
    }

    const targetColumnName = fullDataset.headers[targetColumnIndex];
    const targetData = fullDataset.rows.map(row => parseFloat(row[targetColumnIndex])).filter(v => !isNaN(v));

    if (targetData.length === 0) {
        return "Error: The target column contains no valid numeric data for analysis.";
    }

    const targetMean = targetData.reduce((a, b) => a + b, 0) / targetData.length;
    const targetStdDev = Math.sqrt(targetData.map(x => Math.pow(x - targetMean, 2)).reduce((a, b) => a + b, 0) / targetData.length);
    const targetMin = targetData.reduce((a, b) => Math.min(a, b), Infinity);
    const targetMax = targetData.reduce((a, b) => Math.max(a, b), -Infinity);

    let columnOverview = '';
    const numericColumns = {};

    fullDataset.headers.forEach((header, index) => {
        if (header === targetColumnName) return;

        const colData = fullDataset.rows.map(row => row[index]);
        const missingCount = colData.filter(v => v === null || v === undefined || v === '').length;
        const validData = colData.filter(v => v !== null && v !== undefined && v !== '');

        if (validData.length === 0) {
            columnOverview += `-> Column '${header}': Empty or all missing values.\n`;
            return;
        }

        const numericData = validData.map(v => parseFloat(v)).filter(v => !isNaN(v));
        const potentialDates = validData.map(v => new Date(v)).filter(d => !isNaN(d.getTime()));

        if (potentialDates.length / validData.length > 0.8) {
            const minDate = new Date(Math.min(...potentialDates));
            const maxDate = new Date(Math.max(...potentialDates));
            columnOverview += `-> Column '${header}': DateTime.\n`;
            columnOverview += `   - Range: ${minDate.toISOString().split('T')[0]} to ${maxDate.toISOString().split('T')[0]}\n`;
            columnOverview += `   - Missing values: ${missingCount}\n`;
        } else if (numericData.length / validData.length > 0.8) {
            const stats = {};
            if (numericData.length > 0) {
                stats.min = numericData.reduce((a, b) => Math.min(a, b), Infinity);
                stats.max = numericData.reduce((a, b) => Math.max(a, b), -Infinity);
                stats.mean = numericData.reduce((a, b) => a + b, 0) / numericData.length;
                stats.std = Math.sqrt(numericData.map(x => Math.pow(x - stats.mean, 2)).reduce((a, b) => a + b, 0) / numericData.length);
                stats.median = calculateMedian(numericData);
                stats.skew = calculateSkewness(numericData, stats.mean, stats.std);
                stats.kurtosis = calculateKurtosis(numericData, stats.mean, stats.std);
                numericColumns[header] = numericData;
            }

            columnOverview += `-> Column '${header}': Numeric.\n`;
            if (numericData.length > 0) {
                columnOverview += `   - Range: ${stats.min.toFixed(2)} to ${stats.max.toFixed(2)}\n`;
                columnOverview += `   - Mean: ${stats.mean.toFixed(2)}, Std Dev: ${stats.std.toFixed(2)}\n`;
                columnOverview += `   - Median: ${stats.median.toFixed(2)}, Skewness: ${stats.skew.toFixed(2)}, Kurtosis: ${stats.kurtosis.toFixed(2)}\n`;
            }
            columnOverview += `   - Missing values: ${missingCount}\n`;
        } else {
            const freqMap = validData.reduce((acc, val) => {
                acc[val] = (acc[val] || 0) + 1;
                return acc;
            }, {});

            const sortedValues = Object.entries(freqMap).sort((a, b) => b[1] - a[1]);
            const top3 = sortedValues.slice(0, 3);
            const topDesc = top3.map(([val, count]) => `'${val}' (${count})`).join(', ');

            columnOverview += `-> Column '${header}': Categorical/Text.\n`;
            columnOverview += `   - Unique values: ${sortedValues.length}\n`;
            columnOverview += `   - Most frequent: ${topDesc}\n`;
            columnOverview += `   - Missing values: ${missingCount}\n`;
        }
    });

    const numericHeaders = Object.keys(numericColumns);
    if (numericHeaders.length > 1) {
        let corrTexts = [];
        for (let i = 0; i < numericHeaders.length; i++) {
            for (let j = i + 1; j < numericHeaders.length; j++) {
                const header1 = numericHeaders[i];
                const header2 = numericHeaders[j];

                const alignedData = fullDataset.rows.map(row => ({
                    val1: parseFloat(row[fullDataset.headers.indexOf(header1)]),
                    val2: parseFloat(row[fullDataset.headers.indexOf(header2)])
                })).filter(d => !isNaN(d.val1) && !isNaN(d.val2));

                if (alignedData.length > 1) {
                    const aligned1 = alignedData.map(d => d.val1);
                    const aligned2 = alignedData.map(d => d.val2);
                    const corrValue = calculateCorrelation(aligned1, aligned2);

                    if (Math.abs(corrValue) > 0.7) {
                        corrTexts.push(`'${header1}' and '${header2}' (correlation = ${corrValue.toFixed(2)})`);
                    }
                }
            }
        }
        if (corrTexts.length > 0) {
            columnOverview += `\nStrong correlations found between: ${corrTexts.join('; ')}.\n`;
        }
    }

    const createCategoryJson = (categoryHypotheses) => {
        if (!categoryHypotheses || categoryHypotheses.length === 0) {
            return "No significant hypotheses found for this category.";
        }
        const top10 = categoryHypotheses.slice(0, 10).map(h => ({
            claim: String(h.Hypothesis_Text || '').replace(/\*\*|`/g, ''),
            q_value: h.Significance_qValue_Formatted ?? h.Significance_qValue,
            impact_lift: h.Impact_Lift,
            coverage: h.Coverage,
            homogeneity: h.Homogeneity_Formatted ?? h.Homogeneity,
            fitness_score: h.Fitness_Score,
            source_method: h.source_method
        }));
        return JSON.stringify(top10, null, 2);
    };

    const greaterThanJson = createCategoryJson(categorizedHypotheses['greater than']);
    const lessThanJson = createCategoryJson(categorizedHypotheses['less than']);
    const varianceJson = createCategoryJson(categorizedHypotheses['variance is higher']);

    let userSelectedHypothesesSection = '';
    const selectedCheckboxes = document.querySelectorAll('.hypothesis-checkbox:checked');
    if (selectedCheckboxes.length > 0) {
        const selectedHypotheses = Array.from(selectedCheckboxes).map(cb => ({
            claim: (cb.dataset.hypothesisText || '').replace(/Claim: /i, '').replace(/&quot;/g, '"'),
            q_value: cb.dataset.qValueFormatted || parseFloat(cb.dataset.qValue),
            impact_lift: parseFloat(cb.dataset.impactLift),
            coverage: parseFloat(cb.dataset.coverage),
            homogeneity: cb.dataset.homogeneityFormatted || parseFloat(cb.dataset.homogeneity),
            fitness_score: parseFloat(cb.dataset.fitnessScore),
            source_method: cb.dataset.sourceMethod
        }));
        const userSelectedJson = JSON.stringify(selectedHypotheses, null, 2);
        userSelectedHypothesesSection = `
---

### Hypotheses the user found interesting (in addition to the top 10):
${userSelectedJson}
`;
    }

    const aiAgentPromptElement = document.getElementById('ai-agent-prompt');
    const aiAgentIntent = aiAgentPromptElement ? aiAgentPromptElement.value.trim() : '';

    let combinedContext = "";
    if (userDescription) {
        combinedContext += `**Dataset Description:**\n${userDescription}\n`;
    }
    if (aiAgentIntent) {
        combinedContext += `\n**User's Specific Exploration Goal (AI Agent):**\n${aiAgentIntent}`;
    }
    if (!combinedContext) {
        combinedContext = "No additional context was provided.";
    }

    const prompt = `
You are an expert data analyst and statistician. Your task is to analyze a dataset and a list of hypotheses that have been automatically generated. Your goal is to help the user better understand the dataset, validate or refute the hypotheses, and generate further insights.

### Dataset Summary:
Name: User Uploaded Data
Number of Records: ${fullDataset.rows.length}
Number of Columns: ${fullDataset.headers.length}

**Target Variable: "${targetColumnName}"**
- Mean: ${targetMean.toFixed(2)}
- Standard Deviation: ${targetStdDev.toFixed(2)}
- Min: ${targetMin.toFixed(2)}
- Max: ${targetMax.toFixed(2)}

**Column Overview**:
${columnOverview}

### Additional Context (provided by the user):
${combinedContext}

### Global Statistics:
- Global mean of ${targetColumnName}: ${targetInfo.mean.toFixed(2)}
- Global variance: ${targetInfo.variance.toFixed(2)}

---

### Metric Definitions:
The following metrics are used to evaluate each hypothesis in the JSON lists below.
- **claim**: The hypothesis statement.
- **q_value**: The False Discovery Rate (FDR). A low q-value (e.g., < 0.05) indicates the finding is statistically significant and not a random fluke.
- **impact_lift**: The ratio of the subgroup's average to the global average. A high lift (> 1) signifies a strong, meaningful effect.
- **coverage**: The percentage of the total dataset that the subgroup represents. It indicates how widespread the finding is.
- **homogeneity**: How internally consistent the subgroup is. Higher values indicate more coherent groups.
- **fitness_score**: A composite score from 0 to 1 combining all metrics to give a single measure of a hypothesis's overall quality.
- **source_method**: The algorithm used to generate the hypothesis.

---

### Top Hypotheses by Category (JSON format):

**Hypotheses for "Mean > Global Mean"**
${greaterThanJson}

**Hypotheses for "Mean < Global Mean"**
${lessThanJson}

**Hypotheses for "Variance > Global"**
${varianceJson}

${userSelectedHypothesesSection}

---

### Your Task:
You must structure your answer in exactly two major sections with these exact headings:

### Narrator Agent
In this section:
- Start with a brief introduction presenting yourself as an AI data analyst.
- Analyze the most important findings from the provided hypotheses.
- Focus on the 2-3 strongest findings overall.
- Explain each finding in accessible language.
- Relate the explanation to the user's exploration goal when relevant.
- Justify why each finding matters using q_value, impact_lift, coverage, homogeneity, and fitness_score.

### Next-Step Agent
In this section:
- Propose 2 new, more complex hypotheses or exploration directions.
- These suggestions must be actionable and testable.
- Keep this section concise and clearly separated from the interpretation above.

Formatting rules:
- Use clear headings and short paragraphs.
- Do not merge the Narrator Agent and Next-Step Agent sections.
- The headings must be written exactly as:
  - "### Narrator Agent"
  - "### Next-Step Agent"
`;

    console.log("--- Generated LLM Prompt for Verification ---");
    console.log(prompt);

    return prompt.trim();
}

/**
 * Renders the AI chat panel in the UI.
 * @param {string} prompt The initial prompt to send.
 */
function renderAIPanel(prompt) {
    const container = document.querySelector('#ai-utilities-panel .bg-gray-50');
    if (!container) {
        console.error('AI utilities panel container not found.');
        return;
    }

    const existingPanel = document.getElementById('ai-analysis-panel');
    if (existingPanel) {
        existingPanel.remove();
    }

    const panelHTML = `
        <div id="ai-analysis-panel" class="mt-4 p-4 border rounded-lg bg-white shadow-inner relative">
            <button id="close-ai-panel-btn" class="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-2xl font-bold z-10">&times;</button>
            <div>
                <div class="mb-3 flex items-center justify-between">
                    <h3 class="text-lg font-semibold text-gray-800">AI Analysis</h3>
                    <span class="text-xs font-medium bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                        Structured output
                    </span>
                </div>
                <div id="ai-chat-messages" class="mb-2 border rounded-lg p-3 h-[40rem] overflow-y-auto bg-gray-50">
                    <p class="text-gray-500">The AI's structured response will appear here.</p>
                </div>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', panelHTML);

    document.getElementById('close-ai-panel-btn')?.addEventListener('click', () => {
        document.getElementById('ai-analysis-panel')?.remove();
        chatHistory = [];
        currentAnalysisSections = { narrator: '', nextSteps: '' };
        aiRoundCounter = 1;
    });
}

/**
 * Fetches a response from the AI backend.
 */
async function fetchAIResponse() {
    const chatBox = document.getElementById('ai-chat-messages');
    if (!chatBox) {
        console.error("AI chat container #ai-chat-messages not found.");
        return;
    }

    const provider = getSelectedAIProvider();
    const apiKey = document.getElementById('ai-agent-api-key')?.disabled
        ? ''
        : (document.getElementById('ai-agent-api-key')?.value.trim() || '');
    const modelName = document.getElementById('ai-agent-model')?.value.trim() || getDefaultModelForProvider(provider);
    const temp = parseFloat(document.getElementById('ai-agent-temperature')?.value) || 0.5;

    const thinkingIndicator = document.createElement('div');
    thinkingIndicator.className = 'mt-4';
    thinkingIndicator.innerHTML = `
        <div class="border border-gray-200 bg-white rounded-xl p-4 shadow-sm">
            <p class="font-semibold">AI</p>
            <p class="text-gray-600">Thinking and organizing the answer into Narrator Agent and Next-Step Agent...</p>
        </div>
    `;
    chatBox.appendChild(thinkingIndicator);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const response = await fetch('http://localhost:8000/chat_with_ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                history: chatHistory,
                provider: provider,
                api_key: apiKey,
                model_name: modelName,
                temperature: temp
            })
        });

        thinkingIndicator.remove();

        if (!response.ok) {
            let errMessage = 'An unknown backend error occurred.';
            try {
                const errData = await response.json();
                errMessage = errData.error || errData.detail || errMessage;
            } catch (_) {}
            throw new Error(errMessage);
        }

        const data = await response.json();
        const aiText = data.text || '';

        chatHistory.push({ role: "model", parts: [{ text: aiText }] });

        const isFirstResponse = chatHistory.length === 2;
        renderStructuredAIResponse(aiText, isFirstResponse);

    } catch (error) {
        console.error("AI Fetch Error:", error);

        if (thinkingIndicator.parentNode) {
            thinkingIndicator.remove();
        }

        const errorDiv = document.createElement('div');
        errorDiv.className = 'mt-4';
        errorDiv.innerHTML = `
            <div class="border border-red-200 bg-red-50 rounded-xl p-4 shadow-sm">
                <p class="text-red-600 font-semibold">Error</p>
                <p class="text-red-500">${escapeHtml(error.message)}</p>
            </div>
        `;
        chatBox.appendChild(errorDiv);
    } finally {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

/**
 * Handles sending the user's message to the AI.
 * Mantido apenas por compatibilidade, mas protegido caso os elementos não existam.
 */
async function handleSendMessage() {
    const input = document.getElementById('ai-chat-input');
    const sendButton = document.getElementById('ai-chat-send-btn');
    const chatBox = document.getElementById('ai-chat-messages');

    if (!input || !sendButton || !chatBox) {
        console.warn("Follow-up chat controls are not present in the current UI.");
        return;
    }

    const message = input.value.trim();
    if (!message) return;

    chatHistory.push({ role: "user", parts: [{ text: message }] });

    const userMessageDiv = document.createElement('div');
    userMessageDiv.className = 'text-right mt-4';
    userMessageDiv.innerHTML = `<p class="font-semibold">You</p><p>${escapeHtml(message)}</p>`;
    chatBox.appendChild(userMessageDiv);

    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;
    sendButton.disabled = true;
    input.disabled = true;

    await fetchAIResponse();
}

async function handleAIAnalysis() {
    const selectedTargetIcon = document.querySelector('.target-icon.text-green-500');
    if (selectedTargetIcon) {
        window.hypothesesApp.targetColumnIndex = parseInt(selectedTargetIcon.dataset.index, 10);
    } else {
        window.hypothesesApp.targetColumnIndex = null;
    }

    const { targetColumnIndex } = window.hypothesesApp;
    if (typeof targetColumnIndex !== 'number' || targetColumnIndex < 0) {
        const errorMessage = "Please select a target variable before starting the AI analysis.";
        console.error("AI Analysis stopped: Target variable not set.", "Received index:", targetColumnIndex);
        showModal(errorMessage);
        return;
    }

    const descriptionInput = document.getElementById('dataset-description');
    if (descriptionInput) {
        window.hypothesesApp.userDescription = descriptionInput.value;
    }

    let prompt;
    try {
        prompt = buildLLMPrompt();
    } catch (err) {
        console.error("Error inside buildLLMPrompt():", err);
        showModal("Error while building the AI prompt. Check the console for details.");
        return;
    }

    if (typeof prompt !== 'string') {
        console.error("buildLLMPrompt() returned:", prompt);
        showModal("Error: Failed to build the AI prompt.");
        return;
    }

    if (prompt.startsWith("Error:")) {
        console.error("Stopping AI Analysis due to prompt generation error.");
        showModal(prompt);
        return;
    }

    aiRoundCounter = 1;
    currentAnalysisSections = { narrator: '', nextSteps: '' };

    renderAIPanel(prompt);

    const chatBox = document.getElementById('ai-chat-messages');
    if (chatBox) {
        chatBox.innerHTML = `<p class="text-gray-500">Sending initial prompt to the backend... please wait.</p>`;
    }

    chatHistory = [{ role: "user", parts: [{ text: prompt }] }];

    await fetchAIResponse();

    const firstUserMessage = chatBox?.querySelector('p.text-gray-500');
    if (firstUserMessage) {
        firstUserMessage.remove();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAIProviderUI();
});