# SHEVA 2.0: Automated Hypothesis-Driven Discovery

<p align="center">
  <img width="757" alt="SHEVA 2.0 Interface" src="https://github.com/user-attachments/assets/e6b04e97-37a0-46e0-b7fa-de52afec09c8" />
</p>

SHEVA 2.0 is a web-based analytical tool designed to bridge the gap between raw tabular data and deep, actionable insights. It automates the process of knowledge discovery by systematically generating, testing, and visualizing complex hypotheses. The system employs a suite of advanced algorithms—including Greedy Beam Search, Genetic Algorithms, Deep Reinforcement Learning, and Autonomous AI Agents—to navigate the vast combinatorial space of potential insights, balancing the trade-off between exploring new patterns and exploiting known ones.

The core strength of SHEVA 2.0 lies in its ability to augment Large Language Models (LLMs). By feeding a curated set of statistically robust, multi-conditional, and non-obvious hypotheses to an AI, it enables the generation of analytical narratives that are significantly deeper and more reliable than what LLMs can produce from raw data alone.

## Features

* **Multi-Algorithm Discovery**: Choose from heuristic methods (Greedy Beam Search, Alpha-Investing, Decision Trees, Genetic Algorithm, Deep Reinforcement Learning) or AI-Driven Generation to find insights.
* **Autonomous AI Agent**: A LangChain-powered agent (running on Groq / Llama 3 70B) that takes a natural language "User Intent", explores the dataset through a 10-iteration memory loop, and generates highly targeted, non-repetitive hypotheses.
* **Comprehensive Data Preparation**: An interactive UI to set a target variable, map binary columns, and automatically discretize numeric features.
* **Rich Interactive Visualizations**: Explore results through sortable tables, hierarchical trees (D3.js), sunburst charts (Plotly), a t-SNE-based "Hypotheses Cloud", a co-occurrence heatmap, and a metric analysis scatterplot.
* **Multi-Metric Evaluation**: Hypotheses are rigorously evaluated on significance (One-sample t-test / q-value), impact (lift), coverage, diversity, and homogeneity.
* **AI-Powered Narrative Generation**: Integrates with Groq (Llama 3 70B) to transform validated hypotheses into a rich, contextualized analytical summary and interactive chat.

---

## Getting Started

Follow these instructions to set up and run the SHEVA 2.0 application on your local machine.

### 1. Prerequisites

Before you begin, ensure you have the following installed:

* **Python**: Version 3.8 or newer. You can download it from [python.org](https://www.python.org/downloads/).
* **Git**: To clone the repository. You can download it from [git-scm.com](https://git-scm.com/downloads).
* **Groq API Key**: The application uses Groq's blazing-fast inference for the Llama 3 model.
    1. Go to the [GroqCloud Console](https://console.groq.com/keys).
    2. Click "**Create API Key**".
    3. Copy the generated key. You will need this for the setup.

### 2. Installation & Setup

**Step 1: Clone the Repository**

Open your terminal or command prompt and clone the project repository from GitHub.

```bash
git clone https://github.com/your-username/SHEVA-2.0.git
cd SHEVA-2.0
```

**Step 2: Set Up a Python Virtual Environment (Recommended)**

It's best practice to create a virtual environment to manage project dependencies without affecting your global Python installation.

```bash
# For Windows
python -m venv venv
.\venv\Scripts\activate

# For macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

**Step 3: Install Required Python Libraries**

The backend relies on FastAPI, scientific computing libraries, and LangChain. Install them all using pip.

```bash
pip install "fastapi[all]" uvicorn pandas numpy scikit-learn torch statsmodels langchain langchain-core langchain-community langchain-groq
```

**Step 4: Set the Groq API Key**

You must add your Groq API key directly into the backend code.

1. Open the `main.py` file in your code editor.
2. Locate the AI Agent functions (e.g., `discover_with_ai_agent` and `chat_with_ai`).
3. Replace the placeholder/hardcoded key with your actual Groq API key:

```python
llm = ChatGroq(
    api_key="gsk_YOUR_GROQ_API_KEY_HERE",
    model_name="llama-3.3-70b-versatile",
    temperature=0.2
)
```

> **Important**: Be careful not to share this file publicly with your API key inside. Use `os.getenv("GROQ_API_KEY")` for production environments.

---

## Running the Application

SHEVA 2.0 consists of a Python backend and a JavaScript frontend. You need to run **two separate servers** in **two separate terminal windows** for the application to work correctly.

### Terminal 1: Start the Backend Server

The backend is a FastAPI application that performs all the heavy lifting: data processing, hypothesis generation, and communication with the LangChain/Groq AI.

1. Make sure you are in the project's root directory (`SHEVA-2.0`) and your virtual environment is activated.
2. Run the following command to start the Uvicorn server:

```bash
python -m uvicorn main:app --reload
```

* **`python -m uvicorn`**: Ensures the server runs inside your active virtual environment.
* **`main:app`**: Tells Uvicorn to look inside `main.py` for the `app` instance.
* **`--reload`**: Enables auto-reloading for development.

You should see output indicating the server is running on `http://127.0.0.1:8000`.

### Terminal 2: Start the Frontend Server

The frontend consists of HTML, CSS, and JavaScript files. You need to serve them from a local web server.

1. Open a **new terminal window**.
2. Navigate to the same project root directory (`SHEVA-2.0`).
3. Run Python's built-in HTTP server:

```bash
# For Python 3
python -m http.server 5500
```

* **`5500`**: Specifies the port number to avoid conflicts with the backend.

### Accessing the Application

1. Open your web browser and navigate to **`http://localhost:5500`**. This will open the `index.html` landing page.
2. You will be prompted to log in. This login is for demonstration purposes. Use the following credentials:
    * **Username**: `admin`
    * **Password**: `password`
3. After a successful login, you will be redirected to the main analysis tool (`sheva.html`).

---

## How to Use SHEVA 2.0: A Step-by-Step Tutorial

<p align="center">
  <img width="751" alt="Tutorial Diagram" src="https://github.com/user-attachments/assets/093558f8-fbee-43c5-a1a2-16d861c03edb" />
</p>

This guide will walk you through the entire analysis workflow, from uploading data to interpreting AI-generated insights.

### Step 1: Upload Your Data

* On the main analysis page (`sheva.html`), click the **Upload CSV** button in the top-right corner.
* Select a `.csv` file from your computer. The file must have a header row and at least one data row.
* Once uploaded, a preview of your data will appear in the **Data Sample** section.

### Step 2: Prepare Your Data for Analysis

This is the most critical setup phase.

1. **Set the Target Column**:
    * Your **target column** is the primary metric you want to analyze (e.g., `sales`, `arrest_rate`, `quality_score`).
    * **This column must be numeric.**
    * Hover over a numeric column's header and click the **bullseye icon** (<i class="fas fa-bullseye"></i>) to set it as the target. The icon will turn green.

2. **Map Binary Columns (Optional)**:
    * If you have categorical columns with only two values (e.g., 'Yes'/'No'), you can convert them to `1`s and `0`s by clicking the **exchange icon** (<i class="fas fa-exchange-alt"></i>).

3. **Discretize Numeric Data**:
    * The discovery algorithms work best with categorical data. This step automatically converts all other numeric columns (except the target) into categorical bins.
    * Once you have set a target column, the **Discretize Numeric Data** button will become active. Click it to proceed.

### Step 3: Generate Hypotheses

**Guided AI Discovery (New):**

* Go to the **Hypothesis Generation Via AI Agents** tab.
* In the text box, describe your specific business goal or what you need from the dataset (e.g., *"I want to discover highly engaged audience niches to target paid traffic campaigns"*).
* Check the box to enable the AI Agent. The LangChain agent will read your intent, analyze the dataset summary, and run multiple iterative memory loops to discover complex, non-obvious hypotheses.

**Heuristic Methods:**

* You can also switch to the **Heuristic Algorithms** tab and select methods like Beam Search or Genetic Algorithm to run in parallel with the AI Agent.

**Start the Discovery:**

* Click the **Generate Hypotheses** button. The backend will test all proposed hypotheses against strict statistical rules (One-sample T-test) and discard any that are not statistically significant.

### Step 4: Explore the Results

<p align="center">
  <img width="752" alt="Results Dashboard" src="https://github.com/user-attachments/assets/52d975c7-cfa5-427d-8434-7a135129e480" />
</p>

When the analysis is complete, a tabbed results panel will appear.

* **Table View**: The default view, showing all significant hypotheses sorted by a composite **Score**. Notice the "Method" column, which shows if a hypothesis was found by the AI Agent, a heuristic algorithm, or both.
* **Tree View**: An interactive, collapsible tree that organizes hypotheses hierarchically.
* **Sunburst View**: A radial chart that visualizes the coverage of different subgroups.
* **Hypotheses Cloud**: A t-SNE scatterplot to identify clusters of similar, high-quality insights.
* **Hypotheses Heatmap**: Shows which attribute-value pairs tend to appear together in top hypotheses.
* **Metric Analysis**: A scatterplot to analyze trade-offs between metrics like Impact vs. Coverage.

### Step 5: Analyze with AI (Narrator)

This is where you transform the structured findings into a human-readable story.

1. Select the hypotheses you find most interesting using the checkboxes in the **Table View**.
2. Scroll down to the **AI-Powered Analysis** panel and click **Analyze with AI**.
3. The system constructs a detailed prompt for the Llama 3 model, including the dataset summary, your original intent, and the top-rated/selected hypotheses.
4. An AI chat panel will appear with a detailed analysis. It will:
    * Provide a high-level summary of compelling discoveries.
    * Drill down into 2-3 key findings.
    * Explain why these subgroups exhibit the described behavior.
5. You can continue the conversation by typing follow-up questions in the chat box.
