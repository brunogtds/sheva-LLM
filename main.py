### --- PYTHON BACKEND FOR AI ANALYSIS ---
import pandas as pd
import numpy as np
import time
import json
import ast
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from fastapi.middleware.cors import CORSMiddleware
import random
from itertools import combinations, product, cycle
import google.generativeai as genai

# --- LangChain, Groq e OpenAI Imports ---
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langchain_core.prompts import PromptTemplate
from langchain_core.messages import HumanMessage, AIMessage

# Import helper functions from utils.py
import utils

import uuid
from threading import Thread

AI_PROGRESS = {}
AI_RESULTS = {}

# --- PyTorch Imports for DRL ---
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    import torch.nn.functional as F
    from torch.distributions import Categorical
    PYTORCH_AVAILABLE = True
except ImportError:
    PYTORCH_AVAILABLE = False

# --- Scikit-learn Imports for Decision Trees ---
try:
    from sklearn.tree import DecisionTreeRegressor
    from scipy import stats
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False


# --- FastAPI App Initialization ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models for API Payload ---
class LoginPayload(BaseModel):
    username: str
    password: str

class TablePayload(BaseModel):
    headers: List[str]
    rows: List[List[str]]
    target_column_index: int
    description: str
    methods: Optional[Dict[str, Any]] = None
    comparison_column_indices: Optional[List[int]] = None

class ChatPayload(BaseModel):
    history: List[Dict[str, Any]]
    provider: Optional[str] = "OpenAI"
    api_key: Optional[str] = ""
    model_name: Optional[str] = "gpt-5.4-mini"
    temperature: Optional[float] = 0.2


# --- Gemini AI Configuration (somente se existir chave no ambiente) ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


def init_ai_progress(job_id, total_runs):
    AI_PROGRESS[job_id] = {
        "status": "running",
        "message": "Generating hypotheses... This may take a few seconds.",
        "progress": 0,
        "current_run": 0,
        "total_runs": total_runs
    }


# =====================================================================
# HELPER FUNCTIONS
# =====================================================================

def build_llm(provider: str, model_name: str, temperature: float, api_key: str):
    def resolve_key(env_var_name: str, provided_key: str):
        # Prioridade 1: key digitada na UI
        if provided_key and provided_key.strip():
            return provided_key.strip(), "ui"

        # Prioridade 2: variável de ambiente
        env_key = os.getenv(env_var_name, "").strip()
        if env_key:
            return env_key, "environment"

        return None, None

    if provider == "OpenAI":
        key, source = resolve_key("OPENAI_API_KEY", api_key)
        if not key:
            raise ValueError(
                "OpenAI API key not found. Please set OPENAI_API_KEY in the environment or paste a key in the UI."
            )

        print(f"[INFO] OpenAI key loaded from {source}.")
        return ChatOpenAI(
            model=model_name,
            temperature=temperature,
            api_key=key
        )

    if provider == "Groq":
        key, source = resolve_key("GROQ_API_KEY", api_key)
        if not key:
            raise ValueError(
                "Groq API key not found. Please set GROQ_API_KEY in the environment or paste a key in the UI."
            )

        print(f"[INFO] Groq key loaded from {source}.")
        return ChatGroq(
            model_name=model_name,
            temperature=temperature,
            api_key=key
        )

    raise ValueError(f"Unknown provider: {provider}")


def format_metric_value(x, normal_decimals=5, sci_decimals=2, tiny_threshold=1e-4):
    if pd.isna(x):
        return ""
    try:
        x = float(x)
    except Exception:
        return str(x)

    if np.isnan(x):
        return ""
    if np.isposinf(x):
        return "∞"
    if np.isneginf(x):
        return "-∞"
    if x == 0:
        return "0"

    if abs(x) < tiny_threshold:
        return f"{x:.{sci_decimals}e}"

    return f"{x:.{normal_decimals}f}".rstrip("0").rstrip(".")


def _extract_first_json_array_string(txt: str) -> str:
    i = txt.find("[")
    j = txt.rfind("]")
    if i != -1 and j != -1 and j > i:
        return txt[i : j + 1]
    return ""


def _safe_load_json_array(txt: str):
    s = _extract_first_json_array_string(txt) or "[]"
    try:
        parsed = json.loads(s)
    except Exception:
        try:
            parsed = ast.literal_eval(s)
        except Exception:
            parsed = []
    if isinstance(parsed, dict):
        parsed = [parsed]
    if not isinstance(parsed, list):
        parsed = []
    return parsed


def _canonical_condition_tuple(c: dict):
    return (str(c.get("column", "")), str(c.get("op", "")), str(c.get("value", "")))


def canonical_hypo_key(h: dict):
    conds = h.get("conditions") or []
    conds_sorted = sorted([_canonical_condition_tuple(c) for c in conds])
    return (
        str(h.get("target_metric", "")),
        str(h.get("comparison", "")),
        str(h.get("aggregation", "mean")),
        tuple(conds_sorted),
    )


def dedup_hypotheses(hyp_list, seen_keys):
    out = []
    for h in hyp_list:
        k = canonical_hypo_key(h)
        if k in seen_keys:
            continue
        seen_keys.add(k)
        out.append(h)
    return out, seen_keys


def enforce_significance_filter(df: pd.DataFrame, alpha: float = 0.05, debug_label: str = "") -> pd.DataFrame:
    """
    Garante que apenas hipóteses significativas permaneçam.
    Prioridade:
    1) Se houver q-value, ele é a fonte de verdade.
    2) Se não houver q-value, usa is_significant.
    """
    if df is None or df.empty:
        return pd.DataFrame() if df is None else df.copy()

    filtered_df = df.copy()

    has_q = 'Significance_qValue' in filtered_df.columns
    has_sig = 'is_significant' in filtered_df.columns

    if has_q:
        filtered_df['Significance_qValue'] = pd.to_numeric(
            filtered_df['Significance_qValue'], errors='coerce'
        )

    if has_sig:
        filtered_df['is_significant'] = filtered_df['is_significant'].fillna(False).astype(bool)

    # Se temos q-value, ele manda
    if has_q:
        q_sig_mask = filtered_df['Significance_qValue'].notna() & (filtered_df['Significance_qValue'] < alpha)

        if has_sig:
            inconsistent = filtered_df[
                (filtered_df['is_significant'] == True) &
                (
                    filtered_df['Significance_qValue'].isna() |
                    (filtered_df['Significance_qValue'] >= alpha)
                )
            ]
            if not inconsistent.empty:
                print(f"[WARNING] {debug_label}: Found {len(inconsistent)} inconsistent rows "
                      f"with is_significant=True but q-value >= {alpha} or NaN.")
                cols_to_show = [c for c in ['Hypothesis_Text', 'Significance_qValue', 'is_significant'] if c in inconsistent.columns]
                print(inconsistent[cols_to_show].head(10).to_string(index=False))

        filtered_df = filtered_df[q_sig_mask].copy()

        # mantém coerência visual/logística
        if has_sig:
            filtered_df['is_significant'] = True

        return filtered_df

    # fallback: sem q-value, usa is_significant
    if has_sig:
        return filtered_df[filtered_df['is_significant'] == True].copy()

    # sem nenhuma coluna de significância, retorna como está
    print(f"[WARNING] {debug_label}: No significance columns found. Returning unfiltered dataframe.")
    return filtered_df


HYPOTHESIS_PROMPT_WITH_MEMORY = """
# Hypothesis Agent Prompt

You are a **Hypothesis Agent** specialized in exploratory data analysis for datasets.

Your task is to generate **statistically testable hypotheses** that compare a **subgroup of the dataset** to a **global statistic** using a **one-sample t-test**.

A **subgroup** is a subset of dataset rows defined by one or more **equality conditions on dataset columns** (for example: `column == value`). These conditions specify the population whose statistic will later be compared against the **global dataset statistic**.

You **do not compute statistics or p-values**. Your role is only to **propose candidate hypotheses** that define meaningful subgroups for later statistical testing.

If there is a user intention, guide your hypotheses towards solving it.

---

## Available Information

You only have access to summary information in **DATA CONTEXT**, such as:

- global mean
- global variance
- most frequent categorical values
- column descriptions

Rules:

- Use **only information explicitly present** in DATA CONTEXT.
- **Do not estimate** correlations, significance, or effect sizes.
- Do not invent statistics.
- Guide your hypothesis towards the user intention if provided.

---

## Baseline

Each hypothesis compares a subgroup against the **GLOBAL statistic of `{target_dimension}`**.

Allowed baselines:

- global **mean**
- global **variance**

---

## Hypothesis Format

Each hypothesis must follow this JSON schema:

{{
  "target_metric": "{target_dimension}",
  "comparison": ">" | "<",
  "aggregation": "mean" | "variance",
  "conditions": [
    {{"column": "COLUMN_NAME", "op": "==", "value": "VALUE"}}
  ]
}}

Constraints:

- Use **only columns present in DATA CONTEXT**. Each hypothesis may contain one or more attributes.
- COMPARISON must be > or <
- AGGREGATION must be MEAN or VARIANCE
- Avoid returning multiple hypotheses that describe almost the same subgroup.

## Objective

Generate hypotheses considering:

- **Coverage**: explore different dataset regions
- **Diversity**: avoid nearly identical subgroups
- **Impact**: prioritize subgroups whose target mean meaningfully deviates from the global mean
- **Homogeneity**: coherent, interpretable subgroups

Before generating hypotheses, explicitly identify which dataset dimensions
are most relevant to the USER INTENT and prioritize them.
Never assume relationships not supported by DATA CONTEXT.

---

## User Intent

{user_intent}

---

## Data Context

{data_context}

---

## Previous Hypotheses (Memory)

These hypotheses were already generated and **must not be repeated**.

You may:

- **EXPLOIT:** refine them by adding conditions
- **EXPLORE:** generate hypotheses using new columns or values


{previous_hypotheses_json}

---

## Output Format (Strict)

Return **ONLY a JSON array**.

- No explanations
- No comments
- No prose

Generate exactly **{min_hypotheses} hypotheses** not present in memory.

Example:

OUTPUT (STRICT):
Return ONLY a JSON array (no prose), with {min_hypotheses} hypotheses (not in memory):

[
  {{
    "target_metric": "{target_dimension}",
    "comparison": ">",
    "aggregation": "mean",
    "conditions": [
      {{"column": "...", "op": "==", "value": "..."}}
    ]
  }}
]
"""

hypothesis_old_2 = """ You are a Hypothesis Agent specialized in scientific data exploration.
Your goal: generate statistically testable hypotheses (one-sample t-test vs global mean).

Each hypothesis MUST be a JSON object with:
- "target_metric": "{target_dimension}"
- "comparison": ">" or "<"
- "aggregation": "mean" or "variance"
- "conditions": list of {{"column":..., "op":"==","value":"..."}}

CONSTRAINTS:
- Use ONLY existing dataset columns.
- Comparison must be ONLY ">" or "<".
- Baseline is the GLOBAL mean or GLOBAL variance of {target_dimension}.

OBJECTIVE:
- The USER INTENT defines what is relevant.

Before generating hypotheses, you must:
1) Identify which dataset dimensions are directly related to the intent.
2) Prioritize those dimensions.
3) Generate hypotheses that help explain, refine, or challenge the user's question.

Do NOT generate hypotheses that are statistically interesting but irrelevant
to the user's objective.

Every hypothesis must clearly contribute to answering the user’s goal.

=== USER INTENT ===
{user_intent}

=== DATA CONTEXT ===
{data_context}

=== PREVIOUS HYPOTHESES (MEMORY) ===
Consider that these hypotheses were already generated in previous runs. You MUST NOT repeat or duplicate them.
Instead you should either explore deeper these hypothesis by adding conditions
OR explore new entirely new regions of the hypothesis space, that also are relevant to the user intent.
PREVIOUS_HYPOTHESES_JSON:
{previous_hypotheses_json}

OUTPUT (STRICT):
Return ONLY a JSON array (no prose), with {min_hypotheses} hypotheses (not in memory):

[
  {{
    "target_metric": "{target_dimension}",
    "comparison": ">" | "<",
    "aggregation": "mean" | "variance",
    "conditions": [{{"column":"...","op":"==","value":"..."}}]
  }}
]
 """

hypothesis_old = """
You are a Hypothesis Agent specialized in scientific data exploration.
Your goal: generate statistically testable hypotheses (one-sample t-test vs global mean).

Each hypothesis MUST be a JSON object with:
- "target_metric": "{target_dimension}"
- "comparison": ">" or "<"
- "aggregation": "mean" or "variance"
- "conditions": list of {{"column":..., "op":"==","value":"..."}}

CONSTRAINTS:
- Use ONLY existing dataset columns.
- Comparison must be ONLY ">" or "<".
- Baseline is the GLOBAL mean or GLOBAL variance of {target_dimension}.

OBJECTIVE:
- Maximize COVERAGE, DIVERSITY, IMPACT and HOMOGENEITY.
- Avoid returning multiple hypotheses that describe almost the same subgroup.

=== USER INTENT ===
{user_intent}

=== DATA CONTEXT ===
{data_context}

=== PREVIOUS HYPOTHESES (MEMORY) ===
Consider that these hypotheses were already generated in previous runs. You MUST NOT repeat or duplicate them.
Instead you should either explore deeper these hypothesis by adding conditions
OR explore new entirely new regions of the hypothesis space, that also are relevant to the user intent.
PREVIOUS_HYPOTHESES_JSON:
{previous_hypotheses_json}

OUTPUT (STRICT):
Return ONLY a JSON array (no prose), with {min_hypotheses} hypotheses (not in memory):

[
  {{
    "target_metric": "{target_dimension}",
    "comparison": ">" | "<",
    "aggregation": "mean" | "variance",
    "conditions": [{{"column":"...","op":"==","value":"..."}}]
  }}
]
"""


def discover_with_ai_agent(full_df, discretized_df, original_df, selected_dimension, global_mean, params, job_id=None):
    print("\n" + "=" * 50)
    print("STARTING FIDELITY AI AGENT (WITH MEMORY & REPAIR LOOP)")
    print("=" * 50)
    print("o prompt é: ", HYPOTHESIS_PROMPT_WITH_MEMORY)

    user_prompt = params.get('prompt', '')
    provider = params.get('provider', 'OpenAI')
    api_key = params.get('api_key', '')
    model_name = params.get('model_name', 'gpt-5.4-mini')
    temperature = float(params.get('temperature', 0.5))

    total_iterations = int(params.get('total_iterations', 3))
    if job_id:
        AI_PROGRESS[job_id] = {
            "status": "running",
            "message": "Generating hypotheses... This may take a few seconds.",
            "progress": 0,
            "current_run": 0,
            "total_runs": total_iterations
        }

    min_hypotheses_per_run = int(params.get('min_hypotheses_per_run', 5))

    # FIXO NO BACKEND: removido da UI
    max_attempts = 3

    debug_logs = {"status": "started", "user_prompt": user_prompt, "runs": []}

    try:
        llm = build_llm(provider, model_name, temperature, api_key)
    except Exception as e:
        print(f"Error initializing LLM: {e}")
        debug_logs["error"] = str(e)
        return pd.DataFrame(), debug_logs

    data_context = utils.describe_dataset_detailed(full_df)
    prompt = PromptTemplate.from_template(HYPOTHESIS_PROMPT_WITH_MEMORY)
    chain = prompt | llm

    memory = []
    seen = set()

    print(f"=> [Step 1] Agent exploring data via {provider} for {total_iterations} runs...")

    for i in range(1, total_iterations + 1):
        print(f"\n   === RUN {i}/{total_iterations} ===")

        prev_json = json.dumps(memory, ensure_ascii=False)
        current_user_intent = user_prompt
        new_hyps_this_run = []

        for attempt in range(1, max_attempts + 1):
            try:
                response_chunks = []

                for chunk in chain.stream({
                    "user_intent": current_user_intent,
                    "data_context": data_context,
                    "previous_hypotheses_json": prev_json,
                    "min_hypotheses": min_hypotheses_per_run,
                    "target_dimension": selected_dimension
                }):
                    if chunk.content:
                        print(chunk.content, end="", flush=True)
                        response_chunks.append(chunk.content)

                last_raw = "".join(response_chunks)
                print("\n")
                debug_logs["runs"].append({"run": i, "attempt": attempt, "raw_response": last_raw})

                parsed = _safe_load_json_array(last_raw)
                parsed, seen = dedup_hypotheses(parsed, seen)

                if len(parsed) >= min_hypotheses_per_run:
                    new_hyps_this_run = parsed
                    break

                current_user_intent = (
                    current_user_intent
                    + f"\n\n(Repair instruction: you returned too few NEW hypotheses. "
                      f"Generate {min_hypotheses_per_run} NEW hypotheses NOT present in PREVIOUS_HYPOTHESES_JSON.)"
                )
            except Exception as e:
                print(f"      -> LLM Error on attempt {attempt}: {e}")

        if new_hyps_this_run:
            print(f"      -> Generated {len(new_hyps_this_run)} NEW hypotheses.")
            memory.extend(new_hyps_this_run)
        else:
            print("      -> No new valid hypotheses generated this run.")

        if job_id:
            progress_pct = int((i / total_iterations) * 100)

            if i < total_iterations:
                AI_PROGRESS[job_id] = {
                    "status": "running",
                    "message": f"Run {i} of {total_iterations} completed. Finishing run {i+1}...",
                    "progress": progress_pct,
                    "current_run": i,
                    "total_runs": total_iterations
                }
            else:
                AI_PROGRESS[job_id] = {
                    "status": "running",
                    "message": f"Run {i} of {total_iterations} completed. Finalizing results...",
                    "progress": progress_pct,
                    "current_run": i,
                    "total_runs": total_iterations
                }

    print(f"\n=> Finished {total_iterations} runs. Total unique hypotheses generated: {len(memory)}")

    formatted_hyps = []
    for h in memory:
        agg = str(h.get("aggregation", "mean")).lower()
        comp = str(h.get("comparison", ">"))

        if agg == "variance":
            op = "variance is higher"
        else:
            op = "greater than" if comp == ">" else "less than"

        conds_list = h.get("conditions", [])

        valid_conds = {}
        for c in conds_list:
            col = c.get("column")
            val = c.get("value")
            if col in discretized_df.columns and col != selected_dimension:
                valid_conds[col] = val

        if valid_conds:
            formatted_hyps.append({
                "Dimension": selected_dimension,
                "Operator": op,
                "Value": global_mean,
                "Conditions": valid_conds
            })

    df_hyps = pd.DataFrame(formatted_hyps)
    if df_hyps.empty:
        print("=> No valid hypotheses generated after all runs.")
        debug_logs["error"] = "No valid hypotheses returned."
        return pd.DataFrame(), debug_logs

    def format_ai_hypothesis_text(row):
        region_str_parts = [f"`{col}` = '{val}'" for col, val in row['Conditions'].items()]
        region_str = " AND ".join(region_str_parts) if region_str_parts else "the entire dataset"

        if 'variance' in row['Operator']:
            return f"Claim: The group defined by {region_str} exhibits a **higher variance** for `{row['Dimension']}` compared to the global dataset."
        else:
            return f"Claim: The group defined by {region_str} has a mean for `{row['Dimension']}` that is **{row['Operator']}** the global average."

    df_hyps['Hypothesis_Text'] = df_hyps.apply(format_ai_hypothesis_text, axis=1)

    print(f"=> [Step 2] Statistician Tool validating {len(df_hyps)} hypotheses...")
    evaluated_df = utils.calculate_fitness_metrics(df_hyps, original_df, discretized_df)
    ranked_df = utils.add_fitness_score(evaluated_df, discretized_df)

    # Garantia extra: só mantemos significativas aqui também
    ranked_df = enforce_significance_filter(ranked_df, alpha=0.05, debug_label="AI_AGENT")

    sig_count = ranked_df['is_significant'].sum() if 'is_significant' in ranked_df.columns else len(ranked_df)
    print(f"   -> {sig_count} hypotheses passed the statistical significance test.")

    debug_logs["status"] = "success"
    debug_logs["final_significant_count"] = int(sig_count)

    if job_id:
        AI_PROGRESS[job_id] = {
            "status": "completed",
            "message": "Finished generating hypotheses.",
            "progress": 100,
            "current_run": total_iterations,
            "total_runs": total_iterations
        }

    return ranked_df, debug_logs


# =====================================================================
# HEURISTIC ALGORITHMS
# =====================================================================

def discover_with_beam_search(discretized_df, original_df, selected_dimension, max_complexity=3, beam_width=3):
    print("\n" + "=" * 50)
    print(f"STARTING BEAM SEARCH (depth={max_complexity}, width={beam_width})")
    print("=" * 50)

    operators = ['greater than', 'less than', 'variance is higher']

    def format_hypothesis_text(row):
        condition_parts = []
        for k, v in row['Conditions'].items():
            value_str = f"'{v}'" if isinstance(v, str) else f"{v:.2f}"
            condition_parts.append(f"`{k}` = {value_str}")
        region_str = " AND ".join(condition_parts)
        if 'variance' in row['Operator']:
            return f"Claim: The group where {region_str} has a **{row['Operator']}** for `{row['Dimension']}` compared to the rest."
        else:
            return f"Claim: The group where {region_str} has a mean for `{row['Dimension']}` that is **{row['Operator']}** the global mean."

    all_significant_hypotheses = []
    level_1_hypotheses = []

    for col in discretized_df.columns:
        for value in discretized_df[col].unique():
            if pd.isna(value):
                continue
            for operator in operators:
                level_1_hypotheses.append({
                    'Conditions': {col: value},
                    'Operator': operator,
                    'Dimension': selected_dimension
                })

    level_1_df = pd.DataFrame(level_1_hypotheses)
    if level_1_df.empty:
        return pd.DataFrame()

    level_1_df['Hypothesis_Text'] = level_1_df.apply(format_hypothesis_text, axis=1)
    level_1_metrics = utils.calculate_fitness_metrics(level_1_df, original_df, discretized_df)
    level_1_scored = utils.add_fitness_score(level_1_metrics, discretized_df)
    significant_level_1 = enforce_significance_filter(level_1_scored, alpha=0.05, debug_label="BEAM_LEVEL_1")
    all_significant_hypotheses.append(significant_level_1)

    beam_df = utils.select_diverse_set(significant_level_1, beam_width, discretized_df)
    beam = beam_df.to_dict('records')

    if not beam:
        return pd.concat(all_significant_hypotheses, ignore_index=True) if all_significant_hypotheses else pd.DataFrame()

    for level in range(2, max_complexity + 1):
        all_new_candidates = []

        for hypothesis in beam:
            current_conditions = hypothesis['Conditions']
            used_attrs = current_conditions.keys()
            available_attrs = [col for col in discretized_df.columns if col not in used_attrs]

            for new_attr in available_attrs:
                for new_value in discretized_df[new_attr].unique():
                    if pd.isna(new_value):
                        continue
                    new_conditions = current_conditions.copy()
                    new_conditions[new_attr] = new_value
                    for operator in operators:
                        all_new_candidates.append({
                            'Conditions': new_conditions,
                            'Operator': operator,
                            'Dimension': selected_dimension
                        })

        if not all_new_candidates:
            break

        level_n_df = pd.DataFrame(all_new_candidates)
        if not level_n_df.empty:
            level_n_df['conditions_str'] = level_n_df['Conditions'].apply(lambda d: str(sorted(d.items())))
            level_n_df = level_n_df.drop_duplicates(subset=['conditions_str', 'Operator']).drop(columns=['conditions_str'])

        level_n_df['Hypothesis_Text'] = level_n_df.apply(format_hypothesis_text, axis=1)
        level_n_metrics = utils.calculate_fitness_metrics(level_n_df, original_df, discretized_df)
        level_n_scored = utils.add_fitness_score(level_n_metrics, discretized_df)
        significant_level_n = enforce_significance_filter(level_n_scored, alpha=0.05, debug_label=f"BEAM_LEVEL_{level}")

        if significant_level_n.empty:
            break

        all_significant_hypotheses.append(significant_level_n)
        beam_df = utils.select_diverse_set(significant_level_n, beam_width, discretized_df)
        beam = beam_df.to_dict('records')

        if not beam:
            break

    final_df = pd.concat(all_significant_hypotheses, ignore_index=True)
    return final_df.drop_duplicates(subset=['Hypothesis_Text'])


def discover_with_beam_search_welchs(discretized_df, original_df, selected_dimension, comparison_column, max_complexity=3, beam_width=3):
    operators = ['greater than', 'less than', 'variance is higher']
    all_significant_hypotheses = []
    level_1_hypotheses = []

    unique_values = discretized_df[comparison_column].unique()
    if len(unique_values) > 50:
        return pd.DataFrame()

    for val_a, val_b in combinations(unique_values, 2):
        for operator in operators:
            level_1_hypotheses.append({
                'Group_A_Conditions': {comparison_column: val_a},
                'Group_B_Conditions': {comparison_column: val_b},
                'Operator': operator,
                'Dimension': selected_dimension
            })

    level_1_df = pd.DataFrame(level_1_hypotheses)
    if level_1_df.empty:
        return pd.DataFrame()

    evaluated_df = utils.calculate_fitness_metrics_welchs(level_1_df, original_df, discretized_df)
    ranked_df = utils.add_fitness_score_welchs(evaluated_df, discretized_df)
    significant_level_1 = enforce_significance_filter(ranked_df, alpha=0.05, debug_label=f"WELCHS_{comparison_column}")
    all_significant_hypotheses.append(significant_level_1)

    if not all_significant_hypotheses:
        return pd.DataFrame()

    return pd.concat(all_significant_hypotheses, ignore_index=True)


def discover_with_genetic_algorithm(discretized_df, original_df, selected_dimension, global_mean, **kwargs):
    population_size = kwargs.get('population_size', 100)
    num_generations = kwargs.get('num_generations', 10)
    max_complexity = kwargs.get('max_complexity', 3)
    mutation_rate = kwargs.get('mutation_rate', 0.5)

    current_population_df = utils.generate_initial_population(
        discretized_df, selected_dimension, global_mean, max_complexity, population_size
    )
    ranked_population_df = pd.DataFrame()

    for gen in range(num_generations + 1):
        population_with_metrics_df = utils.calculate_fitness_metrics(current_population_df, original_df, discretized_df)
        if population_with_metrics_df.empty:
            break

        ranked_population_df = utils.add_fitness_score(population_with_metrics_df, discretized_df)

        if gen < num_generations:
            elitism_size = max(2, int(population_size * 0.05))
            tournament_size = max(3, int(population_size * 0.10))
            if len(ranked_population_df) < tournament_size:
                break

            parents_df = utils.selection_phase(ranked_population_df, elitism_size, tournament_size)
            children_df = utils.crossover_phase(
                parents_df, discretized_df, selected_dimension, global_mean, population_size, max_complexity
            )
            if children_df.empty:
                break

            current_population_df = utils.mutation_phase(children_df, discretized_df, mutation_rate=mutation_rate)

    ranked_population_df = enforce_significance_filter(ranked_population_df, alpha=0.05, debug_label="GA")
    return ranked_population_df.drop_duplicates(subset=['Hypothesis_Text']) if not ranked_population_df.empty else ranked_population_df


def discover_with_drl(discretized_df, original_df, selected_dimension, global_mean, **kwargs):
    if not PYTORCH_AVAILABLE:
        return pd.DataFrame()

    num_generations = kwargs.get('num_generations', 25)
    max_len = kwargs.get('max_len', 3)
    population_size = 300

    env = HypothesisEnv(original_df, discretized_df, selected_dimension, global_mean, max_len=max_len)
    agent = PolicyNetwork(env.state_space_size, env.action_space_size)
    optimizer = optim.Adam(agent.parameters(), lr=0.02)
    all_time_best_hypotheses = pd.DataFrame()

    for generation in range(num_generations):
        population_hypotheses = []
        population_log_probs = []

        for _ in range(population_size):
            operator = random.choice(["greater than", "less than", "variance is higher"])
            state = env.reset(operator=operator)
            log_probs_episode = []
            done = False

            while not done:
                action_mask = env.get_valid_actions_mask()
                action_probs = agent(state, action_mask)
                dist = Categorical(probs=action_probs)
                action = dist.sample()
                next_state, _, done = env.step(action.item())
                log_probs_episode.append(dist.log_prob(action))
                state = next_state

            if env.current_conditions:
                hyp_dict = {
                    'Operator': env.operator,
                    'Conditions': env.current_conditions,
                    'Dimension': selected_dimension
                }
                population_hypotheses.append(hyp_dict)
                population_log_probs.append(log_probs_episode)

        if not population_hypotheses:
            continue

        ranked_population_df = utils.process_rl_discoveries(
            population_hypotheses, original_df, discretized_df, selected_dimension, global_mean
        )
        if ranked_population_df.empty:
            continue

        optimizer.zero_grad()
        total_loss = torch.tensor(0.0)
        successful_hypotheses = ranked_population_df[ranked_population_df['Fitness_Score'] > 0]

        if not successful_hypotheses.empty:
            for _, hyp_row in successful_hypotheses.iterrows():
                original_pop_index = hyp_row['original_index']
                fitness_score = hyp_row['Fitness_Score']
                log_probs_for_hyp = population_log_probs[original_pop_index]
                policy_loss = torch.stack([-log_prob * fitness_score for log_prob in log_probs_for_hyp]).sum()
                total_loss += policy_loss

            if total_loss > 0:
                total_loss.backward()
                optimizer.step()

        all_time_best_hypotheses = pd.concat([all_time_best_hypotheses, ranked_population_df])
        all_time_best_hypotheses.drop_duplicates(subset=['Hypothesis_Text'], inplace=True)
        all_time_best_hypotheses.sort_values(by='Fitness_Score', ascending=False, inplace=True)

    all_time_best_hypotheses = enforce_significance_filter(all_time_best_hypotheses, alpha=0.05, debug_label="DRL")
    return all_time_best_hypotheses


def discover_hypotheses_with_dt(discretized_df, original_df, selected_dimension, global_mean, global_variance, **kwargs):
    if not SKLEARN_AVAILABLE:
        return pd.DataFrame()

    max_depth = kwargs.get('max_depth', 7)
    min_samples_leaf = 1
    X_encoded = pd.get_dummies(discretized_df, drop_first=False)
    feature_names = X_encoded.columns.tolist()
    all_hypotheses = []

    def extract_from_tree(tree, operators_to_test, tree_name):
        tree_structure = tree.tree_
        hypotheses_list = []

        def find_path(node_id, path):
            if tree_structure.children_left[node_id] == tree_structure.children_right[node_id]:
                if not path:
                    return

                conditions = [(feature_names[f_idx], op, t) for f_idx, op, t in path]
                positive_conditions = [c for c in conditions if c[1] == '>']
                if not positive_conditions:
                    return

                region_str = " AND ".join([
                    (f"`{c[0].rsplit('_', 1)[0]}` is '{c[0].rsplit('_', 1)[1]}'"
                     if '_' in c[0] else f"`{c[0]}` > {c[2]:.2f}")
                    for c in positive_conditions
                ])

                for operator in operators_to_test:
                    op_text_map = {
                        "greater than": "mean **greater than** the global average",
                        "less than": "mean **less than** the global average",
                        "variance is higher": "variance **higher than** the global average"
                    }
                    hyp_text = f"Claim: The group where {region_str} has a {op_text_map[operator]}."
                    hypotheses_list.append({
                        'Dimension': selected_dimension,
                        'Operator': operator,
                        'Value': global_mean,
                        'Conditions': positive_conditions,
                        'Hypothesis_Text': hyp_text,
                        'Tree_Source': tree_name
                    })
                return

            feature_idx = tree_structure.feature[node_id]
            threshold = tree_structure.threshold[node_id]
            find_path(tree_structure.children_left[node_id], path + [(feature_idx, '<=', threshold)])
            find_path(tree_structure.children_right[node_id], path + [(feature_idx, '>', threshold)])

        find_path(0, [])
        return hypotheses_list

    y_target_greater = (original_df[selected_dimension] > global_mean).astype(int)
    tree_greater = DecisionTreeRegressor(max_depth=max_depth, min_samples_leaf=min_samples_leaf, random_state=42)
    tree_greater.fit(X_encoded, y_target_greater)
    all_hypotheses.extend(extract_from_tree(tree_greater, ["greater than"], "Tree_Greater"))

    y_target_less = (original_df[selected_dimension] < global_mean).astype(int)
    tree_less = DecisionTreeRegressor(max_depth=max_depth, min_samples_leaf=min_samples_leaf, random_state=43)
    tree_less.fit(X_encoded, y_target_less)
    all_hypotheses.extend(extract_from_tree(tree_less, ["less than"], "Tree_Less"))

    y_target_variance = ((original_df[selected_dimension] - global_mean) ** 2 > global_variance).astype(int)
    tree_variance = DecisionTreeRegressor(max_depth=max_depth, min_samples_leaf=min_samples_leaf, random_state=44)
    tree_variance.fit(X_encoded, y_target_variance)
    all_hypotheses.extend(extract_from_tree(tree_variance, ["variance is higher"], "Tree_Variance"))

    if not all_hypotheses:
        return pd.DataFrame()

    discovered_df = pd.DataFrame(all_hypotheses)

    def convert_dt_conditions(conditions_list):
        conditions_dict = {}
        if isinstance(conditions_list, list):
            for feature_name, op, threshold in conditions_list:
                if op == '>':
                    try:
                        original_col, value = feature_name.rsplit('_', 1)
                        conditions_dict[original_col] = value
                    except ValueError:
                        conditions_dict[feature_name] = f"> {threshold:.2f}"
        return conditions_dict

    discovered_df['Conditions'] = discovered_df['Conditions'].apply(convert_dt_conditions)
    evaluated_df = utils.calculate_fitness_metrics(discovered_df, original_df, discretized_df)
    ranked_df = utils.add_fitness_score(evaluated_df, discretized_df)
    ranked_df = enforce_significance_filter(ranked_df, alpha=0.05, debug_label="DT")
    final_table_df = utils.reformat_tree_output_to_table(ranked_df, discretized_df.columns.tolist())
    return final_table_df


def discover_with_alpha_investing(discretized_df, original_df, selected_dimension, global_mean, global_variance, **kwargs):
    lambda_val = kwargs.get('lambda_val', 0.5)
    n_groups = kwargs.get('n_groups', 20)
    initial_alpha_wealth = kwargs.get('initial_alpha_wealth', 0.5)
    gamma = kwargs.get('gamma', 1.0)
    alpha = kwargs.get('alpha', 0.1)
    max_depth = kwargs.get('max_depth', 2)

    def get_p_value(conditions, operator):
        mask = (discretized_df[list(conditions)] == pd.Series(conditions)).all(axis=1)
        sub_dataset = original_df.loc[mask, selected_dimension].dropna()
        if len(sub_dataset) < 3:
            return 1.0

        if operator in ['greater than', 'less than']:
            op_map = {'greater than': 'greater', 'less than': 'less'}
            ttest_result = stats.ttest_1samp(sub_dataset, popmean=global_mean, alternative=op_map[operator])
            return ttest_result.pvalue

        return 1.0

    def calculate_marginal_diversity(user_set, union_of_existing):
        if not user_set:
            return 0.0
        new_users = user_set - union_of_existing
        return len(new_users) / len(user_set)

    condition_indices = {
        col: {val: set(discretized_df.index[discretized_df[col] == val]) for val in discretized_df[col].unique()}
        for col in discretized_df.columns
    }

    candidates_gt, candidates_lt, candidates_var = [], [], []
    all_candidate_cols = [col for col in discretized_df.columns if col != selected_dimension]

    for depth in range(1, max_depth + 1):
        for cols_combination in combinations(all_candidate_cols, depth):
            unique_values_per_col = [[v for v in discretized_df[col].unique() if pd.notna(v)] for col in cols_combination]
            if not all(unique_values_per_col):
                continue

            for val_combination in product(*unique_values_per_col):
                current_conditions = dict(zip(cols_combination, val_combination))
                subgroup_indices = set(original_df.index)

                for c_col, c_val in current_conditions.items():
                    subgroup_indices.intersection_update(condition_indices[c_col][c_val])

                if len(subgroup_indices) < 3:
                    continue

                base_cand = {
                    'Conditions': current_conditions,
                    'subgroup_size': len(subgroup_indices),
                    'users': subgroup_indices
                }
                candidates_gt.append({**base_cand, 'Operator': 'greater than'})
                candidates_lt.append({**base_cand, 'Operator': 'less than'})
                candidates_var.append({**base_cand, 'Operator': 'variance is higher'})

    sort_key = lambda x: (len(x['Conditions']), -x['subgroup_size'])
    candidates_gt.sort(key=sort_key)
    candidates_lt.sort(key=sort_key)
    candidates_var.sort(key=sort_key)

    omega = initial_alpha_wealth
    G = []
    union_G_users = set()
    candidate_pools = {
        'greater than': candidates_gt,
        'less than': candidates_lt,
        'variance is higher': candidates_var
    }
    operator_cycle = cycle(candidate_pools.keys())

    while omega > 0 and len(G) < n_groups and any(candidate_pools.values()):
        current_operator = next(operator_cycle)
        current_candidates = candidate_pools[current_operator]
        if not current_candidates:
            continue

        best_g = None
        best_g_sort_key = (float('inf'), float('-inf'), float('-inf'))
        total_users = len(original_df)

        for g in current_candidates:
            c_g = len(g['users']) / total_users
            d_g = calculate_marginal_diversity(g['users'], union_G_users)
            obj_val = 0.5 * c_g + lambda_val * d_g
            current_g_sort_key = (len(g['Conditions']), -g['subgroup_size'], -obj_val)
            if current_g_sort_key < best_g_sort_key:
                best_g_sort_key = current_g_sort_key
                best_g = g

        if best_g is None:
            continue

        current_candidates.remove(best_g)

        alpha_star = omega / (gamma + omega)
        x = 1 / (1 + lambda_val)
        newU = len(best_g['users'] - union_G_users) / len(best_g['users']) if len(best_g['users']) > 0 else 0
        coverage_g_star = len(best_g['users']) / total_users
        alpha_j = alpha_star * (x * coverage_g_star + lambda_val * x * newU) ** 0.5

        if omega - (alpha_j / (1 - alpha_j)) >= 0:
            p_value = get_p_value(best_g['Conditions'], best_g['Operator'])
            if p_value <= alpha_j:
                omega += alpha
                G.append(best_g)
                union_G_users.update(best_g['users'])
            else:
                omega -= alpha_j / (1 - alpha_j)
        else:
            break

    if not G:
        return pd.DataFrame()

    discovered_df = pd.DataFrame(G)
    discovered_df['Dimension'] = selected_dimension

    def format_alpha_hypothesis_text(row):
        region_str = " AND ".join([f"`{k.replace('_Class', '')}` = '{v}'" for k, v in row['Conditions'].items()])
        op_text = row['Operator'].replace('is', '').strip()
        target_metric = 'variance' if 'variance' in op_text else 'mean'
        target_val = global_variance if 'variance' in op_text else global_mean
        return f"The group where {region_str} has a {target_metric} for `{row['Dimension']}` that is **{op_text}** the global {target_metric} of {target_val:.2f}."

    discovered_df['Hypothesis_Text'] = discovered_df.apply(format_alpha_hypothesis_text, axis=1)
    evaluated_df = utils.calculate_fitness_metrics(discovered_df, original_df, discretized_df)
    ranked_df = utils.add_fitness_score(evaluated_df, discretized_df)
    ranked_df = enforce_significance_filter(ranked_df, alpha=0.05, debug_label="ALPHA_INVESTING")
    return ranked_df


# =====================================================================
# API ENDPOINTS
# =====================================================================

@app.get("/available_llm_providers")
def available_llm_providers():
    return {
        "OpenAI": {
            "has_env_key": bool(os.getenv("OPENAI_API_KEY", "").strip()),
            "default_model": "gpt-5.4-mini"
        },
        "Groq": {
            "has_env_key": bool(os.getenv("GROQ_API_KEY", "").strip()),
            "default_model": "llama-3.3-70b-versatile"
        }
    }


@app.post("/login")
def login(payload: LoginPayload):
    if payload.username == "admin" and payload.password == "password":
        return {"success": True, "message": "Login successful"}
    else:
        raise HTTPException(status_code=401, detail="Invalid username or password")


@app.post("/generate")
def run_hypothesis_generation(payload: TablePayload):
    start_time = time.time()

    df = pd.DataFrame(payload.rows, columns=payload.headers)
    standardized_cols = [col.lower().replace(' ', '_') for col in df.columns]

    cols = pd.Series(standardized_cols)
    for dup in cols[cols.duplicated()].unique():
        cols[cols[cols == dup].index.values.tolist()] = [
            dup + '.' + str(i) if i != 0 else dup for i in range(sum(cols == dup))
        ]
    df.columns = cols

    df = df.replace('', np.nan).dropna()
    df.reset_index(drop=True, inplace=True)

    selected_dimension = df.columns[payload.target_column_index]

    original_df = df.copy()
    original_df[selected_dimension] = pd.to_numeric(original_df[selected_dimension], errors='coerce')
    original_df.dropna(subset=[selected_dimension], inplace=True)

    discretized_df = df.loc[original_df.index].drop(columns=[selected_dimension])

    global_mean = original_df[selected_dimension].mean()
    global_variance = original_df[selected_dimension].var()

    all_hypotheses_list = []
    executed_methods_summary = []

    if not payload.methods:
        return {"message": "No hypothesis generation methods were selected."}

    for method_key, params in payload.methods.items():
        if method_key == 'gbs':
            run_params_gbs = {"algorithm_name": "Beam Search", **params}
            gbs_result_df = discover_with_beam_search(
                discretized_df,
                original_df,
                selected_dimension,
                max_complexity=params.get('max_complexity', 3),
                beam_width=params.get('beam_width', 5)
            )
            if not gbs_result_df.empty:
                gbs_result_df['source_method'] = 'Beam Search'
                all_hypotheses_list.append(gbs_result_df)
            executed_methods_summary.append(run_params_gbs)
            continue

        result_df = pd.DataFrame()
        run_params = {"algorithm_name": "Unknown", **params}

        if method_key == 'ga':
            run_params['algorithm_name'] = "Genetic Algorithm"
            result_df = discover_with_genetic_algorithm(
                discretized_df, original_df, selected_dimension, global_mean, **params
            )
            if not result_df.empty:
                result_df['source_method'] = 'Genetic Algorithm'

        elif method_key == 'drl':
            run_params['algorithm_name'] = "Deep Reinforcement Learning"
            result_df = discover_with_drl(
                discretized_df, original_df, selected_dimension, global_mean, **params
            )
            if not result_df.empty:
                result_df['source_method'] = 'DRL'

        elif method_key == 'dt':
            run_params['algorithm_name'] = "Decision Tree"
            result_df = discover_hypotheses_with_dt(
                discretized_df, original_df, selected_dimension, global_mean, global_variance, **params
            )
            if not result_df.empty:
                result_df['source_method'] = 'Decision Tree'

        elif method_key == 'alpha_i':
            run_params['algorithm_name'] = "Alpha-Investing"
            result_df = discover_with_alpha_investing(
                discretized_df, original_df, selected_dimension, global_mean, global_variance, **params
            )
            if not result_df.empty:
                result_df['source_method'] = 'Alpha-Investing'

        elif method_key == 'two_sample':
            run_params['algorithm_name'] = "Compare Groups (Welch's Test)"
            if payload.comparison_column_indices:
                all_welchs_results = []
                for comp_index in payload.comparison_column_indices:
                    comparison_column_name = df.columns[comp_index]
                    welchs_df = discover_with_beam_search_welchs(
                        discretized_df,
                        original_df,
                        selected_dimension,
                        comparison_column_name,
                        max_complexity=1,
                        beam_width=10
                    )
                    if not welchs_df.empty:
                        all_welchs_results.append(welchs_df)

                if all_welchs_results:
                    result_df = pd.concat(all_welchs_results, ignore_index=True)
                    result_df['source_method'] = "Compare Groups"

        elif method_key == 'ai_agent':
            run_params['algorithm_name'] = "AI Agent"

            result_df, ai_logs = discover_with_ai_agent(
                df, discretized_df, original_df, selected_dimension, global_mean, params
            )

            run_params['ai_agent_logs'] = ai_logs
            if not result_df.empty:
                result_df['source_method'] = 'AI Agent'

        if not result_df.empty:
            # filtro extra defensivo
            result_df = enforce_significance_filter(
                result_df,
                alpha=0.05,
                debug_label=f"ROUTE_GENERATE_{run_params['algorithm_name']}"
            )
            if not result_df.empty:
                all_hypotheses_list.append(result_df)

        if run_params['algorithm_name'] != "Unknown":
            executed_methods_summary.append(run_params)

    if not all_hypotheses_list:
        return {
            "run_params": {"methods": executed_methods_summary},
            "final_hypotheses_df": [],
            "sunburst_json": None,
            "message": "No significant hypotheses were found by any selected method."
        }

    all_hypotheses_df = pd.concat(all_hypotheses_list, ignore_index=True)

    if not all_hypotheses_df.empty:
        all_hypotheses_df = enforce_significance_filter(
            all_hypotheses_df,
            alpha=0.05,
            debug_label="ROUTE_GENERATE_FINAL_MERGE"
        )

        if 'Fitness_Score' in all_hypotheses_df.columns:
            all_hypotheses_df.sort_values(by='Fitness_Score', ascending=False, inplace=True)

        def create_canonical_key(row):
            if 'Conditions' in row and isinstance(row.get('Conditions'), dict):
                return str(sorted(row['Conditions'].items()))
            elif 'Group_A_Conditions' in row and isinstance(row.get('Group_A_Conditions'), dict):
                key_a = str(sorted(row['Group_A_Conditions'].items()))
                key_b = str(sorted(row['Group_B_Conditions'].items()))
                return str(sorted([key_a, key_b]))
            return str(row.name)

        all_hypotheses_df['canonical_conditions'] = all_hypotheses_df.apply(create_canonical_key, axis=1)

        source_methods_agg = all_hypotheses_df.groupby(
            ['canonical_conditions', 'Operator']
        )['source_method'].apply(lambda x: ', '.join(sorted(x.unique()))).reset_index()

        best_hypotheses = all_hypotheses_df.drop_duplicates(
            subset=['canonical_conditions', 'Operator'],
            keep='first'
        )

        all_hypotheses_df = pd.merge(
            best_hypotheses.drop(columns=['source_method']),
            source_methods_agg,
            on=['canonical_conditions', 'Operator']
        )
        all_hypotheses_df.drop(columns=['canonical_conditions'], inplace=True)

    def format_welchs_text(row):
        if pd.isna(row.get('Hypothesis_Text')) and 'Group_A_Conditions' in row and isinstance(row.get('Group_A_Conditions'), dict):
            col = list(row['Group_A_Conditions'].keys())[0]
            val_a = row['Group_A_Conditions'][col]
            val_b = row['Group_B_Conditions'][col]
            return f"Claim: The mean of `{row['Dimension']}` for `{col}`='{val_a}' is significantly **{row['Operator']}** `{col}`='{val_b}'."
        return row['Hypothesis_Text']

    all_hypotheses_df['Hypothesis_Text'] = all_hypotheses_df.apply(format_welchs_text, axis=1)

    formatted_results_df = utils.format_results_table(all_hypotheses_df, discretized_df.columns.tolist())

    # filtro final extra, caso format_results_table preserve as colunas
    formatted_results_df = enforce_significance_filter(
        formatted_results_df,
        alpha=0.05,
        debug_label="FORMATTED_RESULTS_GENERATE"
    )

    df_for_sunburst = formatted_results_df.head(50)
    sunburst_fig = utils.plot_sunburst_hypotheses(
        df_for_sunburst,
        discretized_df,
        selected_dimension,
        global_mean,
        global_variance
    )
    sunburst_json = sunburst_fig.to_json() if sunburst_fig else None

    if 'Significance_qValue' in formatted_results_df.columns:
        formatted_results_df['Significance_qValue_Formatted'] = (
            formatted_results_df['Significance_qValue'].apply(format_metric_value)
        )

    if 'Homogeneity' in formatted_results_df.columns:
        formatted_results_df['Homogeneity_Formatted'] = (
            formatted_results_df['Homogeneity'].apply(format_metric_value)
        )

    final_run_params = {
        "methods": executed_methods_summary,
        "selected_dimension": selected_dimension,
        "global_mean": global_mean,
        "global_variance": global_variance,
        "execution_time_seconds": round(time.time() - start_time, 2)
    }

    hypotheses_json = json.loads(formatted_results_df.to_json(orient='records'))

    return {
        "run_params": final_run_params,
        "final_hypotheses_df": hypotheses_json,
        "sunburst_json": sunburst_json
    }


@app.post("/chat_with_ai")
def chat_with_ai(payload: ChatPayload):
    try:
        llm = build_llm(payload.provider, payload.model_name, payload.temperature, payload.api_key)

        messages = []
        for msg in payload.history:
            role = msg.get("role")
            parts = msg.get("parts", [])
            text = parts[0].get("text", "") if parts else ""

            if role == "user":
                messages.append(HumanMessage(content=text))
            elif role == "model":
                messages.append(AIMessage(content=text))

        response = llm.invoke(messages)
        return {"text": response.content}

    except Exception as e:
        print(f"An error occurred during AI chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate_ai_async")
def generate_ai_async(payload: TablePayload):
    if not payload.methods or 'ai_agent' not in payload.methods:
        raise HTTPException(status_code=400, detail="AI Agent method not provided.")

    job_id = str(uuid.uuid4())
    params = payload.methods['ai_agent']
    total_runs = int(params.get('total_iterations', 2))

    init_ai_progress(job_id, total_runs)

    def run_job():
        try:
            df = pd.DataFrame(payload.rows, columns=payload.headers)
            standardized_cols = [col.lower().replace(' ', '_') for col in df.columns]

            cols = pd.Series(standardized_cols)
            for dup in cols[cols.duplicated()].unique():
                cols[cols[cols == dup].index.values.tolist()] = [
                    dup + '.' + str(i) if i != 0 else dup for i in range(sum(cols == dup))
                ]
            df.columns = cols

            df = df.replace('', np.nan).dropna()
            df.reset_index(drop=True, inplace=True)

            selected_dimension = df.columns[payload.target_column_index]

            original_df = df.copy()
            original_df[selected_dimension] = pd.to_numeric(original_df[selected_dimension], errors='coerce')
            original_df.dropna(subset=[selected_dimension], inplace=True)

            discretized_df = df.loc[original_df.index].drop(columns=[selected_dimension])
            global_mean = original_df[selected_dimension].mean()

            result_df, ai_logs = discover_with_ai_agent(
                df,
                discretized_df,
                original_df,
                selected_dimension,
                global_mean,
                params,
                job_id=job_id
            )

            # ESTE ERA O PONTO MAIS IMPORTANTE:
            result_df = enforce_significance_filter(
                result_df,
                alpha=0.05,
                debug_label="ASYNC_AI_AGENT_RESULT"
            )

            if not result_df.empty:
                result_df['source_method'] = 'AI Agent'

            formatted_results_df = utils.format_results_table(result_df, discretized_df.columns.tolist())

            # filtro extra defensivo após formatação
            formatted_results_df = enforce_significance_filter(
                formatted_results_df,
                alpha=0.05,
                debug_label="ASYNC_FORMATTED_RESULTS"
            )

            if 'Significance_qValue' in formatted_results_df.columns:
                formatted_results_df['Significance_qValue_Formatted'] = (
                    formatted_results_df['Significance_qValue'].apply(format_metric_value)
                )

            if 'Homogeneity' in formatted_results_df.columns:
                formatted_results_df['Homogeneity_Formatted'] = (
                    formatted_results_df['Homogeneity'].apply(format_metric_value)
                )

            AI_RESULTS[job_id] = {
                "run_params": {
                    "methods": [{"algorithm_name": "AI Agent", **params, "ai_agent_logs": ai_logs}],
                    "selected_dimension": selected_dimension,
                    "global_mean": global_mean
                },
                "final_hypotheses_df": json.loads(formatted_results_df.to_json(orient='records')),
                "sunburst_json": None
            }

            AI_PROGRESS[job_id] = {
                "status": "completed",
                "message": "Finished generating hypotheses.",
                "progress": 100,
                "current_run": total_runs,
                "total_runs": total_runs
            }

        except Exception as e:
            AI_PROGRESS[job_id] = {
                "status": "error",
                "message": str(e),
                "progress": 100,
                "current_run": 0,
                "total_runs": total_runs
            }

    Thread(target=run_job, daemon=True).start()

    return {"job_id": job_id}


@app.get("/generate_ai_progress/{job_id}")
def generate_ai_progress(job_id: str):
    if job_id not in AI_PROGRESS:
        raise HTTPException(status_code=404, detail="Job not found.")
    return AI_PROGRESS[job_id]


@app.get("/generate_ai_result/{job_id}")
def generate_ai_result(job_id: str):
    if job_id not in AI_RESULTS:
        progress = AI_PROGRESS.get(job_id)
        if progress and progress.get("status") == "error":
            raise HTTPException(status_code=500, detail=progress.get("message", "Unknown error"))
        raise HTTPException(status_code=202, detail="Result not ready yet.")
    return AI_RESULTS[job_id]