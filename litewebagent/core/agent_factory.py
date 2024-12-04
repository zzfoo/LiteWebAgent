import sys
import os
import logging
from dotenv import load_dotenv
from openai import OpenAI
from ..agents.FunctionCallingAgents.FunctionCallingAgent import FunctionCallingAgent
from ..agents.FunctionCallingAgents.HighLevelPlanningAgent import HighLevelPlanningAgent
from ..agents.FunctionCallingAgents.ContextAwarePlanningAgent import ContextAwarePlanningAgent
from ..agents.PromptAgents.PromptAgent import PromptAgent
from ..utils.utils import setup_logger
from ..utils.playwright_manager import setup_playwright
from ..tools.registry import ToolRegistry

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_ = load_dotenv()

logger = logging.getLogger(__name__)
openai_client = OpenAI()

# Define the default features
DEFAULT_FEATURES = ['screenshot', 'dom', 'axtree', 'focused_element', 'extra_properties', 'interactive_elements']

AGENT_CLASSES = {
    "FunctionCallingAgent": FunctionCallingAgent,
    "HighLevelPlanningAgent": HighLevelPlanningAgent,
    "ContextAwarePlanningAgent": ContextAwarePlanningAgent,
}

def create_function_wrapper(func, **kwargs):
    def wrapper(task_description):
        return func(task_description, **kwargs)

    return wrapper


def setup_function_calling_web_agent(starting_url, goal, playwright_manager, model_name="gpt-4o-mini", agent_type="DemoAgent", tool_names = ["navigation", "select_option", "upload_file", "webscraping"],
                                     features=['axtree'], elements_filter=None,
                                     branching_factor=None, log_folder="log", memory_path=None):
    logger = setup_logger()

    if features is None:
        features = DEFAULT_FEATURES

    memory = None
    if memory_path is not None:
        with open(memory_path, 'r', encoding='utf8') as f:
            memory = f.read()
    print(f"Memory: {memory}")
    tool_registry = ToolRegistry()
    available_tools = {}
    tools = []
    for tool_name in tool_names:
        available_tools[tool_name] = create_function_wrapper(tool_registry.get_tool(tool_name).func, features=features, elements_filter=elements_filter, branching_factor=branching_factor, playwright_manager=playwright_manager, log_folder=log_folder)
        tools.append(tool_registry.get_tool_description(tool_name))

    messages = [
        {
            "role": "system",
            "content": """You are a web search agent designed to perform specific tasks on web pages as instructed by the user. Your primary objectives are:

    1. Execute ONLY the task explicitly provided by the user.
    2. Perform the task efficiently and accurately using the available functions.
    3. If there are errors, retry using a different approach within the scope of the given task.
    4. Once the current task is completed, stop and wait for further instructions.

    Critical guidelines:
    - Strictly limit your actions to the current task. Do not attempt additional tasks or next steps.
    - Use only the functions provided to you. Do not attempt to use functions or methods that are not explicitly available.
    - For navigation or interaction with page elements, always use the appropriate bid (browser element ID) when required by a function.
    - If a task cannot be completed with the available functions, report the limitation rather than attempting unsupported actions.
    - After completing a task, report its completion and await new instructions. Do not suggest or initiate further actions.

    Remember: Your role is to execute the given task precisely as instructed, using only the provided functions and within the confines of the current web page. Do not exceed these boundaries under any circumstances."""
        }
    ]
    # file_path = os.path.join(log_folder, 'flow', 'steps.json')
    # os.makedirs(os.path.dirname(file_path), exist_ok=True)
    page = playwright_manager.get_page()
    if starting_url!=None:
        page.goto(starting_url)
    # Maximize the window on macOS
    # page.set_viewport_size({"width": 1440, "height": 900})

    # with open(file_path, 'w') as file:
    #     file.write(goal + '\n')
    #     file.write(starting_url + '\n')

    try:
        agent_class = AGENT_CLASSES[agent_type]
        agent = agent_class(model_name=model_name, tools=tools, 
        available_tools=available_tools,
                                       messages=messages, goal=goal, memory=memory, playwright_manager=playwright_manager,
                                       log_folder=log_folder)
    except KeyError:
        error_message = f"Unsupported agent type: {agent_type}. Please use 'FunctionCallingAgent', 'HighLevelPlanningAgent', 'ContextAwarePlanningAgent', 'PromptAgent' or 'PromptSearchAgent' ."
        logger.error(error_message)
        return {"error": error_message}
    return agent


def setup_prompting_web_agent(starting_url, goal, playwright_manager, model_name="gpt-4o-mini", agent_type="DemoAgent", features=['axtree'], elements_filter=None,
                              branching_factor=None, log_folder="log", storage_state='state.json', headless=False):
    logger = setup_logger()
    if features is None:
        features = DEFAULT_FEATURES

    messages = [
        {
            "role": "system",
            "content": """You are a web search agent designed to perform specific tasks on web pages as instructed by the user. Your primary objectives are:

    1. Execute ONLY the task explicitly provided by the user.
    2. Perform the task efficiently and accurately using the available functions.
    3. If there are errors, retry using a different approach within the scope of the given task.
    4. Once the current task is completed, stop and wait for further instructions.

    Critical guidelines:
    - Strictly limit your actions to the current task. Do not attempt additional tasks or next steps.
    - Use only the functions provided to you. Do not attempt to use functions or methods that are not explicitly available.
    - For navigation or interaction with page elements, always use the appropriate bid (browser element ID) when required by a function.
    - If a task cannot be completed with the available functions, report the limitation rather than attempting unsupported actions.
    - After completing a task, report its completion and await new instructions. Do not suggest or initiate further actions.

    Remember: Your role is to execute the given task precisely as instructed, using only the provided functions and within the confines of the current web page. Do not exceed these boundaries under any circumstances."""
        }
    ]

    page = playwright_manager.get_page()
    page.goto(starting_url)
    # Maximize the window on macOS
    # page.set_viewport_size({"width": 1440, "height": 900})

    file_path = os.path.join(log_folder, 'flow', 'steps.json')
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, 'w') as file:
        file.write(goal + '\n')
        file.write(starting_url + '\n')

    if agent_type == "PromptAgent":
        agent = PromptAgent(model_name=model_name,
                            messages=messages, goal=goal, playwright_manager=playwright_manager, features=features, elements_filter=elements_filter, branching_factor=branching_factor, log_folder=log_folder)
    else:
        error_message = f"Unsupported agent type: {agent_type}. Please use 'PromptAgent'."
        logger.error(error_message)
        return {"error": error_message}
    return agent

