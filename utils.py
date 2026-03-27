import pandas as pd
import numpy as np
import plotly.graph_objects as go
from scipy import stats
from statsmodels.stats.multitest import fdrcorrection
import random

# --- Helper & Core Algorithm Functions ---

def _calculate_jaccard_distance(indices1, indices2):
    """Helper function to calculate the Jaccard distance between two sets of row indices."""
    if not isinstance(indices1, set):
        indices1 = set(indices1)
    if not isinstance(indices2, set):
        indices2 = set(indices2)
    intersection_size = len(indices1.intersection(indices2))
    union_size = len(indices1.union(indices2))
    if union_size == 0:
        return 0.0
    jaccard_similarity = intersection_size / union_size
    return 1.0 - jaccard_similarity

def calculate_fitness_metrics(hypotheses_to_test_df, original_df, discretized_df):
    """Calculates key fitness metrics for a batch of hypotheses."""
    if hypotheses_to_test_df.empty:
        return pd.DataFrame()

    fitness_results = []
    dimension_col = hypotheses_to_test_df['Dimension'].iloc[0]
    global_mean = original_df[dimension_col].mean()
    global_variance = original_df[dimension_col].var()

    for _, hypothesis in hypotheses_to_test_df.iterrows():
        filter_mask = pd.Series(True, index=original_df.index)
        conditions = hypothesis['Conditions']

        for col, val in conditions.items():
            if col in discretized_df.columns:
                filter_mask &= (discretized_df[col] == val)

        sub_dataset = original_df[filter_mask]
        metrics = {
            'Coverage': len(sub_dataset) / len(original_df) if len(original_df) > 0 else 0
        }

        dimension = hypothesis['Dimension']
        op_type = hypothesis['Operator']

        # poucos dados -> hipótese fraca / não testável
        if len(sub_dataset) < 3:
            metrics.update({
                'Impact_Lift': 0.0,
                'Significance_pValue': 1.0,
                'Homogeneity': 0.0
            })
            fitness_results.append(metrics)
            continue

        sub_values = pd.to_numeric(sub_dataset[dimension], errors='coerce').dropna()

        if len(sub_values) < 3:
            metrics.update({
                'Impact_Lift': 0.0,
                'Significance_pValue': 1.0,
                'Homogeneity': 0.0
            })
            fitness_results.append(metrics)
            continue

        sub_mean = sub_values.mean()
        sub_var = sub_values.var(ddof=1)

        # proteção extra
        if pd.isna(sub_var) or sub_var < 0:
            sub_var = 0.0

        # HOMOGENEITY ESTÁVEL: sempre entre 0 e 1
        stable_homogeneity = 1.0 / (1.0 + sub_var)

        if op_type in ['greater than', 'less than']:
            metrics['Homogeneity'] = stable_homogeneity
            alternative = 'greater' if op_type == 'greater than' else 'less'

            if global_mean == 0 or pd.isna(global_mean):
                metrics['Impact_Lift'] = 0.0
            else:
                metrics['Impact_Lift'] = sub_mean / global_mean

            try:
                ttest_result = stats.ttest_1samp(
                    sub_values,
                    popmean=global_mean,
                    alternative=alternative
                )
                pvalue = float(ttest_result.pvalue) if not pd.isna(ttest_result.pvalue) else 1.0
            except Exception:
                pvalue = 1.0

            metrics['Significance_pValue'] = min(max(pvalue, 0.0), 1.0)

        elif op_type == 'variance is higher':
            # Aqui também vale manter uma homogeneity numérica válida
            metrics['Homogeneity'] = stable_homogeneity

            rest_of_dataset = original_df.loc[~original_df.index.isin(sub_dataset.index), dimension]
            rest_values = pd.to_numeric(rest_of_dataset, errors='coerce').dropna()

            if len(rest_values) < 3:
                metrics.update({
                    'Impact_Lift': 0.0,
                    'Significance_pValue': 1.0
                })
            else:
                try:
                    levene_stat, levene_p = stats.levene(sub_values, rest_values)
                    levene_p = float(levene_p) if not pd.isna(levene_p) else 1.0
                except Exception:
                    levene_p = 1.0

                if pd.isna(global_variance) or global_variance <= 0:
                    metrics['Impact_Lift'] = 0.0
                else:
                    metrics['Impact_Lift'] = sub_var / global_variance

                if sub_var > global_variance:
                    metrics['Significance_pValue'] = min(max(levene_p / 2, 0.0), 1.0)
                else:
                    metrics['Significance_pValue'] = 1.0

        else:
            metrics.update({
                'Impact_Lift': 0.0,
                'Significance_pValue': 1.0,
                'Homogeneity': 0.0
            })

        fitness_results.append(metrics)

    fitness_df = pd.DataFrame(fitness_results, index=hypotheses_to_test_df.index)
    results_df = pd.concat([hypotheses_to_test_df, fitness_df], axis=1)

    if not results_df.empty and 'Significance_pValue' in results_df.columns:
        p_values = results_df['Significance_pValue'].fillna(1.0).clip(0.0, 1.0).to_numpy()
        reject, q_values = fdrcorrection(p_values, alpha=0.05)
        results_df['Significance_qValue'] = q_values
        results_df['is_significant'] = reject

    return results_df

def add_fitness_score(df_with_metrics, discretized_df):
    """Adds a composite fitness score to the hypotheses DataFrame."""
    if df_with_metrics.empty:
        return df_with_metrics

    df = df_with_metrics.copy()
    df['Diversity'] = 0.0

    significant_df = df[df['is_significant']].copy()

    if len(significant_df) > 1:
        candidate_indices = {
            idx: set(
                discretized_df.index[
                    (discretized_df[list(row['Conditions'])] == pd.Series(row['Conditions'])).all(axis=1)
                ]
            )
            for idx, row in significant_df.iterrows()
        }

        diversity_scores = {}
        for idx1 in significant_df.index:
            distances = [
                _calculate_jaccard_distance(candidate_indices[idx1], candidate_indices[idx2])
                for idx2 in significant_df.index if idx1 != idx2
            ]
            diversity_scores[idx1] = np.mean(distances) if distances else 0.0

        df['Diversity'] = df.index.map(diversity_scores).fillna(0.0)

    # limpar problemas numéricos
    numeric_cols = ['Impact_Lift', 'Coverage', 'Homogeneity', 'Diversity', 'Significance_qValue']
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    def safe_normalize(series, default_value=0.0):
        s = series.copy()
        if s.isna().all():
            return pd.Series(default_value, index=s.index)

        s = s.fillna(s.median() if not s.dropna().empty else default_value)
        min_val = s.min()
        max_val = s.max()

        if pd.isna(min_val) or pd.isna(max_val):
            return pd.Series(default_value, index=s.index)

        if (max_val - min_val) <= 0:
            return pd.Series(0.5, index=s.index)

        return (s - min_val) / (max_val - min_val)

    # pesos
    weights = {
        'Significance_qValue': 0.25,
        'Impact_Lift': 0.25,
        'Coverage': 0.20,
        'Diversity': 0.15,
        'Homogeneity': 0.15
    }

    # normalização das métricas “quanto maior melhor”
    for metric in ['Impact_Lift', 'Coverage', 'Homogeneity', 'Diversity']:
        if metric in df.columns:
            df[f'{metric}_norm'] = safe_normalize(df[metric], default_value=0.0)

    # q-value: quanto menor melhor
    if 'Significance_qValue' in df.columns:
        q = df['Significance_qValue'].clip(lower=1e-12, upper=1.0)
        df['qValue_transformed'] = -np.log10(q)
        df['Significance_qValue_norm'] = safe_normalize(df['qValue_transformed'], default_value=0.0)

    df['Fitness_Score'] = 0.0
    for metric, weight in weights.items():
        norm_col = f'{metric}_norm'
        if norm_col in df.columns:
            df['Fitness_Score'] += df[norm_col].fillna(0.0) * weight

    if 'is_significant' in df.columns:
        df.loc[df['is_significant'] == False, 'Fitness_Score'] = 0.0

    return df.sort_values(by='Fitness_Score', ascending=False).reset_index(drop=True)

def select_diverse_set(candidates_df, k, discretized_df, lambda_val=0.5):
    """Selects a diverse set of k hypotheses using Maximal Marginal Relevance (MMR)."""
    if candidates_df.empty or len(candidates_df) <= k:
        return candidates_df.head(k)
    candidate_indices = {
        idx: set(discretized_df.index[(discretized_df[list(row['Conditions'])] == pd.Series(row['Conditions'])).all(axis=1)])
        for idx, row in candidates_df.iterrows()
    }
    selected_indices = []
    candidates_pool = candidates_df.copy()
    if not candidates_pool.empty:
        first_idx = candidates_pool.index[0]
        selected_indices.append(first_idx)
        candidates_pool = candidates_pool.drop(first_idx)
    while len(selected_indices) < k and not candidates_pool.empty:
        best_next_idx = -1
        max_marginal_gain = -1
        for idx, row in candidates_pool.iterrows():
            avg_dist_to_selected = np.mean([
                _calculate_jaccard_distance(candidate_indices[idx], candidate_indices[sel_idx])
                for sel_idx in selected_indices
            ])
            marginal_gain = row['Fitness_Score'] + (lambda_val * avg_dist_to_selected)
            if marginal_gain > max_marginal_gain:
                max_marginal_gain = marginal_gain
                best_next_idx = idx
        if best_next_idx != -1:
            selected_indices.append(best_next_idx)
            candidates_pool = candidates_pool.drop(best_next_idx)
        else:
            break
    return candidates_df.loc[selected_indices]

# --- Genetic Algorithm Helper Functions ---

def _create_random_hypothesis(operator, max_complexity, discretized_df, selected_dimension, global_mean):
    """Creates a single random hypothesis."""
    num_conditions = random.randint(1, max_complexity)
    all_cols = discretized_df.columns.tolist()
    conditions = {}
    if all_cols:
        k = min(num_conditions, len(all_cols))
        cols_to_use = random.sample(all_cols, k)
        for col in cols_to_use:
            val = random.choice(discretized_df[col].unique())
            conditions[col] = val
    return {
        'Dimension': selected_dimension,
        'Operator': operator,
        'Value': global_mean,
        'Conditions': conditions
    }

def generate_initial_population(discretized_df, selected_dimension, global_mean, max_complexity, population_size):
    """Generates an initial random population of hypotheses."""
    population = []
    operators = ["greater than", "less than", "variance is higher"]
    for _ in range(population_size):
        op_type = random.choice(operators)
        population.append(
            _create_random_hypothesis(op_type, max_complexity, discretized_df, selected_dimension, global_mean)
        )
    for p in population:
        region_str_parts = [f"`{col}` = '{val}'" for col, val in p['Conditions'].items()]
        region_str = " AND ".join(region_str_parts) if region_str_parts else "the entire dataset"
        op_type = p['Operator']
        if op_type in ["greater than", "less than"]:
            p['Hypothesis_Text'] = (f"Claim: The group defined by {region_str} has a mean for `{selected_dimension}` "
                                    f"that is **{op_type}** the global average of {global_mean:.2f}.")
        else:
            p['Hypothesis_Text'] = (f"Claim: The `{selected_dimension}` for the group defined by {region_str} "
                                    f"has a **{op_type}** than the general population.")
    return pd.DataFrame(population)

def selection_phase(ranked_population_df, elitism_size=2, tournament_size=3):
    """Selects individuals (parents) for the next generation using elitism and tournament selection."""
    population_size = len(ranked_population_df)
    operators = ["greater than", "less than", "variance is higher"]
    num_from_each_pool = population_size // len(operators)
    remainder = population_size % len(operators)
    selected_parents = []

    for i, op_type in enumerate(operators):
        pool = ranked_population_df[ranked_population_df['Operator'] == op_type]
        significant_pool = pool[pool['is_significant'] == True]
        parent_pool = significant_pool if len(significant_pool) >= tournament_size else pool

        if parent_pool.empty:
            continue

        pool_elitism_size = min(max(1, elitism_size // len(operators)), len(parent_pool))
        elites = parent_pool.head(pool_elitism_size).copy()
        selected_parents.append(elites)

        num_to_select_via_tournament = num_from_each_pool - pool_elitism_size
        if i < remainder:
            num_to_select_via_tournament += 1

        if num_to_select_via_tournament > 0:
            tournament_parents = []
            for _ in range(num_to_select_via_tournament):
                contenders = parent_pool.sample(n=min(len(parent_pool), tournament_size))
                winner = contenders.sort_values(by='Fitness_Score', ascending=False).iloc[0]
                tournament_parents.append(winner)
            selected_parents.append(pd.DataFrame(tournament_parents))

    if not selected_parents:
        return ranked_population_df.sample(n=population_size, replace=True).reset_index(drop=True)

    return pd.concat(selected_parents, ignore_index=True)

def crossover_phase(parents_df, discretized_df, selected_dimension, global_mean, population_size, max_complexity):
    """Creates the next generation of hypotheses through crossover."""
    new_generation = []
    operators = ["greater than", "less than", "variance is higher"]
    num_per_operator = population_size // len(operators)
    remainder = population_size % len(operators)

    for i, op_type in enumerate(operators):
        parent_pool = parents_df[parents_df['Operator'] == op_type]
        num_to_generate = num_per_operator + (1 if i < remainder else 0)

        if parent_pool.empty:
            for _ in range(num_to_generate):
                new_generation.append(
                    _create_random_hypothesis(op_type, max_complexity, discretized_df, selected_dimension, global_mean)
                )
        else:
            for _ in range(num_to_generate):
                p1, p2 = parent_pool.sample(2, replace=True).iloc
                all_keys = list(p1['Conditions'].keys() | p2['Conditions'].keys())
                child_conditions = {}
                for key in all_keys:
                    source = random.choice([p1, p2])
                    if key in source['Conditions']:
                        child_conditions[key] = source['Conditions'][key]
                new_generation.append({
                    'Dimension': p1['Dimension'], 'Operator': op_type, 'Value': p1['Value'], 'Conditions': child_conditions
                })

    for child in new_generation:
        region_str_parts = [f"`{col}` = '{val}'" for col, val in child['Conditions'].items()]
        region_str = " AND ".join(region_str_parts) if region_str_parts else "the entire dataset"
        op_type = child['Operator']
        if op_type in ["greater than", "less than"]:
            child['Hypothesis_Text'] = (f"Claim: The group defined by {region_str} has a mean for `{selected_dimension}` "
                                        f"that is **{op_type}** the global average of {global_mean:.2f}.")
        else:
            child['Hypothesis_Text'] = (f"Claim: The `{selected_dimension}` for the group defined by {region_str} "
                                        f"has a **{op_type}** than the general population.")
    return pd.DataFrame(new_generation)

def mutation_phase(children_df, discretized_df, mutation_rate=0.05):
    """Applies random mutations to the children population."""
    mutated_children = children_df.copy()
    all_region_cols = discretized_df.columns.tolist()

    for i, child in mutated_children.iterrows():
        if random.random() < mutation_rate:
            if not all_region_cols: continue
            action = random.choice(['add', 'remove', 'modify'])
            child_conditions = child['Conditions'].copy()

            if action == 'add' and len(child_conditions) < len(all_region_cols):
                available_cols = [c for c in all_region_cols if c not in child_conditions]
                if available_cols:
                    col_to_add = random.choice(available_cols)
                    child_conditions[col_to_add] = random.choice(discretized_df[col_to_add].unique())
            elif action == 'remove' and child_conditions:
                col_to_remove = random.choice(list(child_conditions.keys()))
                del child_conditions[col_to_remove]
            elif action == 'modify' and child_conditions:
                col_to_modify = random.choice(list(child_conditions.keys()))
                current_val = child_conditions[col_to_modify]
                possible_vals = [v for v in discretized_df[col_to_modify].unique() if v != current_val]
                if possible_vals:
                    child_conditions[col_to_modify] = random.choice(possible_vals)
            mutated_children.at[i, 'Conditions'] = child_conditions

    for i, row in mutated_children.iterrows():
        conditions = row['Conditions']
        region_str_parts = [f"`{col}` = '{val}'" for col, val in conditions.items()]
        region_str = " AND ".join(region_str_parts) if region_str_parts else "the entire dataset"
        op_type = row['Operator']
        selected_dimension = row['Dimension']
        global_mean = row['Value']
        if op_type in ["greater than", "less than"]:
            mutated_children.at[i, 'Hypothesis_Text'] = (f"Claim: The group defined by {region_str} has a mean for `{selected_dimension}` "
                                                        f"that is **{op_type}** the global average of {global_mean:.2f}.")
        else:
            mutated_children.at[i, 'Hypothesis_Text'] = (f"Claim: The `{selected_dimension}` for the group defined by {region_str} "
                                                        f"has a **{op_type}** than the general population.")
    return mutated_children

# --- DRL Helper Function ---
def process_rl_discoveries(hypotheses, original_df, discretized_df, dimension, global_mean):
    """
    Processes hypotheses generated by the DRL agent, calculates their fitness,
    and prepares them for the training loop.
    """
    if not hypotheses:
        return pd.DataFrame()

    df = pd.DataFrame(hypotheses)
    df['Dimension'] = dimension
    df['original_index'] = df.index # Keep track for mapping back rewards

    # Generate Hypothesis_Text
    for i, row in df.iterrows():
        region_str_parts = [f"`{col}` = '{val}'" for col, val in row['Conditions'].items()]
        region_str = " AND ".join(region_str_parts) if region_str_parts else "the entire dataset"
        op_type = row['Operator']
        if op_type in ["greater than", "less than"]:
            df.at[i, 'Hypothesis_Text'] = (f"Claim: The group defined by {region_str} has a mean for `{dimension}` "
                                           f"that is **{op_type}** the global average of {global_mean:.2f}.")
        else:
            df.at[i, 'Hypothesis_Text'] = (f"Claim: The `{dimension}` for the group defined by {region_str} "
                                           f"has a **{op_type}** than the general population.")

    metrics_df = calculate_fitness_metrics(df, original_df, discretized_df)
    scored_df = add_fitness_score(metrics_df, discretized_df)
    return scored_df

# --- Decision Tree Helper Function ---
def reformat_tree_output_to_table(ranked_df, all_feature_cols):
    """
    Transform raw rule conditions into a user-friendly table format.
    """
    reformatted_rows = []
    base_cols = ranked_df.columns.tolist()

    for _, row in ranked_df.iterrows():
        new_row_data = row.to_dict()

        for col in all_feature_cols:
            new_row_data[col] = "NOT USED"

        conditions_dict_for_plot = {}
        if 'Conditions' in new_row_data and isinstance(new_row_data['Conditions'], dict):
            for feature_name, value in new_row_data['Conditions'].items():
                if feature_name in all_feature_cols:
                     new_row_data[feature_name] = value
                     conditions_dict_for_plot[feature_name] = value

        new_row_data['Conditions'] = conditions_dict_for_plot
        reformatted_rows.append(new_row_data)

    return pd.DataFrame(reformatted_rows)


# --- Formatting and Plotting Functions ---

def format_results_table(df, all_condition_attributes):
    """Formats the final DataFrame for better readability in the output."""
    if df.empty:
        return pd.DataFrame()
    base_attribute_names = sorted([c.replace('_Class', '') for c in all_condition_attributes])
    formatted_rows = []
    for index, row in df.iterrows():
        new_row = row.to_dict()
        for attr in base_attribute_names:
            new_row[attr] = 'NOT USED'
        if 'Conditions' in new_row and isinstance(new_row['Conditions'], dict):
            for condition_key, condition_value in new_row['Conditions'].items():
                base_key = condition_key.replace('_Class', '')
                value_to_display = f'{condition_value:.2f}' if isinstance(condition_value, float) else condition_value
                new_row[base_key] = value_to_display
        formatted_rows.append(new_row)

    if not formatted_rows:
        return pd.DataFrame()
    formatted_df = pd.DataFrame(formatted_rows)
    formatted_df['Aggregation'] = formatted_df['Operator'].apply(lambda x: 'variance' if 'variance' in x else 'mean')
    
    final_columns_order = [
        'Fitness_Score', 'Significance_qValue', 'Impact_Lift', 'Coverage', 'Diversity', 'Homogeneity',
        'is_significant', 'Dimension', 'Aggregation', 'Operator', 'source_method'
    ] + base_attribute_names + ['Hypothesis_Text']
    
    for col in final_columns_order:
        if col not in formatted_df.columns:
            formatted_df[col] = np.nan
            
    return formatted_df[final_columns_order].sort_values(by='Fitness_Score', ascending=False)

def plot_sunburst_hypotheses(df_final_population, discretized_df, selected_dimension, global_mean, global_variance):
    """Generates a sunburst plot to visualize the hierarchy of discovered hypotheses."""
    if df_final_population.empty:
        return None
    df_significant = df_final_population[df_final_population['is_significant']].copy()
    if df_significant.empty:
        return None
    plot_data = []
    root_id = f'{selected_dimension}'
    op_map = {
        "greater than": f"Mean > {global_mean:.2f}",
        "less than": f"Mean < {global_mean:.2f}",
        "variance is higher": f"Variance > {global_variance:.2f}"
    }
    plot_data.append(dict(id=root_id, parent='', label=root_id))
    for op in op_map.values():
        plot_data.append(dict(id=op, parent=root_id, label=op))
    processed_ids = {root_id} | set(op_map.values())
    region_cols = [col.replace('_Class', '') for col in discretized_df.columns]
    for _, row in df_significant.iterrows():
        base_parent = op_map[row['Operator']]
        path_conditions = [(col, str(row[col])) for col in region_cols if row[col] != "NOT USED"]
        if not path_conditions: continue
        parent_id = base_parent
        for i, (col, val) in enumerate(path_conditions):
            label = f"{col}: {val}"
            current_id = f"{parent_id}|{label}"
            if current_id not in processed_ids:
                plot_data.append(dict(id=current_id, parent=parent_id, label=label))
                processed_ids.add(current_id)
            parent_id = current_id
    plot_df = pd.DataFrame(plot_data)
    def get_color(node_id):
        if op_map["greater than"] in node_id: return 'rgba(102, 187, 106, 0.8)'
        if op_map["less than"] in node_id: return 'rgba(239, 83, 80, 0.8)'
        if op_map["variance is higher"] in node_id: return 'rgba(26, 115, 232, 0.8)'
        return 'rgba(240, 240, 240, 1)'
    colors = [get_color(node_id) for node_id in plot_df['id']]
    fig = go.Figure(go.Sunburst(ids=plot_df['id'], labels=plot_df['label'], parents=plot_df['parent'], marker=dict(colors=colors)))
    fig.update_layout(width=1000, height=1000, margin=dict(t=40, l=20, r=20, b=20), title_text="Hierarchical Visualization of Discovered Hypotheses")
    return fig

def calculate_fitness_metrics_welchs(hypotheses_to_test_df, original_df, discretized_df):
    """Calculates fitness metrics specifically for two-sample Welch's t-test hypotheses."""
    if hypotheses_to_test_df.empty:
        return pd.DataFrame()

    fitness_results = []
    dimension_col = hypotheses_to_test_df['Dimension'].iloc[0]

    for _, hypothesis in hypotheses_to_test_df.iterrows():
        metrics = {}
        dimension = hypothesis['Dimension']
        op_type = hypothesis['Operator']

        cond_a = hypothesis['Group_A_Conditions']
        cond_b = hypothesis['Group_B_Conditions']
        mask_a = (discretized_df[list(cond_a)] == pd.Series(cond_a)).all(axis=1)
        mask_b = (discretized_df[list(cond_b)] == pd.Series(cond_b)).all(axis=1)
        
        sample_a = original_df.loc[mask_a, dimension]
        sample_b = original_df.loc[mask_b, dimension]

        metrics['Coverage'] = (len(sample_a) + len(sample_b)) / len(original_df) if len(original_df) > 0 else 0

        if len(sample_a) < 3 or len(sample_b) < 3:
            metrics.update({'Impact_Lift': 0, 'Significance_pValue': 1, 'Homogeneity': np.nan})
        else:
            mean_a, var_a = sample_a.mean(), sample_a.var()
            mean_b, var_b = sample_b.mean(), sample_b.var()

            if op_type in ['greater than', 'less than']:
                alternative = 'greater' if op_type == 'greater than' else 'less'
                ttest_res = stats.ttest_ind(sample_a, sample_b, equal_var=False, alternative=alternative)
                metrics['Significance_pValue'] = ttest_res.pvalue
                metrics['Impact_Lift'] = mean_a / mean_b if mean_b != 0 else 0
            elif op_type == 'variance is higher':
                levene_res = stats.levene(sample_a, sample_b)
                metrics['Significance_pValue'] = levene_res.pvalue / 2 if var_a > var_b else 1.0
                metrics['Impact_Lift'] = var_a / var_b if var_b > 0 else 0
            metrics['Homogeneity'] = np.nan
        
        fitness_results.append(metrics)

    fitness_df = pd.DataFrame(fitness_results, index=hypotheses_to_test_df.index)
    results_df = pd.concat([hypotheses_to_test_df, fitness_df], axis=1)

    if not results_df.empty and 'Significance_pValue' in results_df.columns:
        p_values = results_df['Significance_pValue'].fillna(1.0).to_numpy()
        reject, q_values = fdrcorrection(p_values, alpha=0.05)
        results_df['Significance_qValue'] = q_values
        results_df['is_significant'] = reject
    return results_df

def add_fitness_score_welchs(df_with_metrics, discretized_df):
    """Adds a composite fitness score for two-sample Welch's test hypotheses."""
    if df_with_metrics.empty:
        return df_with_metrics

    df = df_with_metrics.copy()

    weights = {
        'Significance_qValue': 0.4, 
        'Impact_Lift': 0.3, 
        'Coverage': 0.3
    }
    
    metrics_to_normalize = ['Impact_Lift', 'Coverage']
    for metric in metrics_to_normalize:
        if metric in df.columns:
            df[metric].fillna(df[metric].mean(), inplace=True)
            min_val, max_val = df[metric].min(), df[metric].max()
            df[f'{metric}_norm'] = (df[metric] - min_val) / (max_val - min_val) if (max_val - min_val) > 0 else 0.5

    if 'Significance_qValue' in df.columns:
        df['qValue_transformed'] = -np.log10(df['Significance_qValue'] + 1e-10)
        min_q, max_q = df['qValue_transformed'].min(), df['qValue_transformed'].max()
        df['Significance_qValue_norm'] = (df['qValue_transformed'] - min_q) / (max_q - min_q) if (max_q - min_q) > 0 else 0.5

    df['Fitness_Score'] = 0.0
    for metric, weight in weights.items():
        norm_col = f'{metric}_norm'
        if norm_col in df.columns:
            df['Fitness_Score'] += df[norm_col].fillna(0) * weight
    
    if 'is_significant' in df.columns:
        df.loc[df['is_significant'] == False, 'Fitness_Score'] = 0
        
    return df.sort_values(by='Fitness_Score', ascending=False).reset_index(drop=True)

# --- Resumo Textual do Dataset para o LLM ---

def generate_textual_summary(df: pd.DataFrame) -> str:
    """
    Generates a textual summary of the DataFrame to be used as context for the LLM.
    """
    summary_lines = [f"The dataset contains {df.shape[0]} rows and {df.shape[1]} columns.\n"]

    for col_name in df.columns:
        col = df[col_name]
        
        # Check if the column can be treated as numeric
        col_numeric = pd.to_numeric(col, errors='coerce')
        if col_numeric.notna().sum() > len(col) * 0.5:  # Mostly numeric
            valid_data = col_numeric.dropna()
            if len(valid_data) > 0:
                stats_dict = {
                    "min": valid_data.min(),
                    "max": valid_data.max(),
                    "mean": valid_data.mean(),
                    "std": valid_data.std(),
                    "median": valid_data.median(),
                    "skew": stats.skew(valid_data),
                    "kurtosis": stats.kurtosis(valid_data),
                    "missing": col_numeric.isna().sum()
                }
                summary_lines.append(
                    f"-> Column '{col_name}': Numeric.\n"
                    f"   - Range: {stats_dict['min']:.2f} to {stats_dict['max']:.2f}\n"
                    f"   - Mean: {stats_dict['mean']:.2f}, Std Dev: {stats_dict['std']:.2f}\n"
                    f"   - Median: {stats_dict['median']:.2f}, Skewness: {stats_dict['skew']:.2f}, Kurtosis: {stats_dict['kurtosis']:.2f}\n"
                    f"   - Missing values: {stats_dict['missing']}\n"
                )
        else:
            # Treat as Categorical/Text
            top_vals = col.value_counts().head(10)
            top_desc = ', '.join([f"'{val}' ({cnt})" for val, cnt in top_vals.items()])
            summary_lines.append(
                f"-> Column '{col_name}': Categorical/Text.\n"
                f"   - Unique values: {col.nunique()}\n"
                f"   - Most frequent: {top_desc}\n"
                f"   - Missing values: {col.isna().sum()}\n"
            )

    return "\n".join(summary_lines)

# --- ENHANCED DATASET SUMMARY (AI AGENT) ---

def safe_format(value, format_str="{:.2f}"):
    """Função auxiliar para lidar com tipos NumPy no retorno textual e formatação segura"""
    if pd.isna(value) or value is None:
        return "N/A"
    try:
        if isinstance(value, (np.integer, np.floating)):
            value = value.item()
        return format_str.format(value)
    except Exception:
        return str(value)

def describe_dataset_detailed(df: pd.DataFrame) -> str:
    """Gera um sumário textual rico em detalhes estatísticos e alertas de qualidade para o LLM."""
    summary_lines = []
    alerts = []

    # 1. Metadados Gerais
    summary_lines.append(f"The dataset contains {df.shape[0]} rows and {df.shape[1]} columns.")
    summary_lines.append(f"Total duplicated rows: {df.duplicated().sum()}\n")

    # 2. Processar Cada Coluna
    for col_name in df.columns:
        col = df[col_name]
        missing_count = col.isna().sum()
        missing_percentage = (missing_count / len(df)) * 100

        # Alerta para Dados Faltantes
        if missing_percentage > 10.0:
            alerts.append(f"Missing Data '{col_name}': {missing_percentage:.2f}% faltante. Alto volume de dados faltantes.")

        # Variáveis Numéricas
        if pd.api.types.is_numeric_dtype(col):
            stats_dict = col.describe(percentiles=[.05, .50, .95]).to_dict()
            
            skewness = safe_format(stats.skew(col.dropna()))
            kurt = safe_format(stats.kurtosis(col.dropna()))
            mode_val = col.mode().iloc[0] if len(col.mode()) > 0 else "N/A"
            
            summary_lines.append(f"-> Column '{col_name}': Numeric ({col.dtype}).")
            summary_lines.append(f"   - Range: {safe_format(stats_dict.get('min'))} to {safe_format(stats_dict.get('max'))}")
            summary_lines.append(f"   - Mean: {safe_format(stats_dict.get('mean'))}, Std Dev: {safe_format(stats_dict.get('std'))}")
            summary_lines.append(f"   - Median: {safe_format(stats_dict.get('50%'))}, Skewness: {skewness}, Kurtosis: {kurt}")
            summary_lines.append(f"   - Mode (Most Frequent): {mode_val}")
            summary_lines.append(f"   - Percentiles (5% / 95%): {safe_format(stats_dict.get('5%'))} / {safe_format(stats_dict.get('95%'))}")
            summary_lines.append(f"   - Missing values: {missing_count} ({missing_percentage:.2f}%)\n")
            
            # Alerta para Assimetria
            if abs(float(skewness) if skewness != 'N/A' else 0) > 1.0 or abs(float(kurt) if kurt != 'N/A' else 0) > 3.5:
                alerts.append(f"Numeric '{col_name}': Alta Assimetria/Curtose. Sugere distribuição não-normal/outliers.")

        # Variáveis Temporais
        elif pd.api.types.is_datetime64_any_dtype(col):
            start = col.min()
            end = col.max()
            summary_lines.append(f"-> Column '{col_name}': DateTime ({col.dtype}).")
            summary_lines.append(f"   - Range: {start} to {end} (Total days: {(end - start).days if pd.notna(end) and pd.notna(start) else 'N/A'})")
            summary_lines.append(f"   - Missing values: {missing_count} ({missing_percentage:.2f}%)")
            
            if len(col.dropna()) > 0:
                monthly_counts = col.dt.to_period('M').value_counts().sort_index()
                start_sample = dict(monthly_counts.head(3).astype(str))
                end_sample = dict(monthly_counts.tail(3).astype(str))
                summary_lines.append(f"   - Event Counts Sample (Start/End): {start_sample} / {end_sample}\n")
            else:
                 summary_lines.append("\n")

        # Variáveis Categóricas/Texto
        elif pd.api.types.is_object_dtype(col) or pd.api.types.is_categorical_dtype(col):
            nunique = col.nunique()
            unique_ratio = nunique / len(df) if len(df) > 0 else 0
            top_vals = col.value_counts(dropna=False).nlargest(15)
            top_desc = ', '.join([f"'{val}' ({cnt})" for val, cnt in top_vals.items()])
            top1_density = (top_vals.iloc[0] / len(df)) * 100 if len(top_vals) > 0 else 0

            type_label = "Categorical/Text"
            if unique_ratio > 0.95:
                type_label = "High Cardinality (Possible ID)"
            
            summary_lines.append(f"-> Column '{col_name}': {type_label} ({col.dtype}).")
            summary_lines.append(f"   - Unique values: {nunique} (Ratio: {unique_ratio*100:.2f}%)")
            summary_lines.append(f"   - Top 1 Density: {top1_density:.2f}% (Indicates class imbalance)")
            summary_lines.append(f"   - Most frequent (Top 10): {top_desc}")
            summary_lines.append(f"   - Missing values: {missing_count} ({missing_percentage:.2f}%)\n")
            
            if unique_ratio > 0.95:
                alerts.append(f"Categorical '{col_name}': Alta Cardinalidade. Potencial ID, verificar exclusão/hashing.")
                
        else:
            summary_lines.append(f"⚠️ Column '{col_name}': Unrecognized data type ({col.dtype}).\n")

    # 3. Análise de Correlação
    numeric_cols = df.select_dtypes(include=np.number)
    if numeric_cols.shape[1] > 1:
        try:
            corr_matrix = numeric_cols.corr().abs()
            upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
            top_corr = upper.unstack().sort_values(ascending=False).head(10) 

            corr_texts = []
            for (col1, col2), corr_value in top_corr.items():
                if not pd.isna(corr_value) and corr_value > 0.5:
                    corr_texts.append(f"'{col1}' and '{col2}' (Correlation Abs. = {safe_format(corr_value)})")
            
            if corr_texts:
                summary_lines.append("\n Strong correlations found (Top 10, Abs > 0.5) between: " + "; ".join(corr_texts) + ".\n")
                alerts.append("Strong Correlations Found. Check 'Top 10' for multicollinearity issues.")
        except Exception:
            alerts.append("Correlation calculation failed (e.g., constant columns).")

    # 4. Adicionar Alertas no final
    if alerts:
        summary_lines.append("--- 🚨 Quality & Hypothesis ALERTS ---")
        summary_lines.append("• " + "\n• ".join(alerts))
        summary_lines.append("---------------------------------------\n")
        
    return "\n".join(summary_lines)
