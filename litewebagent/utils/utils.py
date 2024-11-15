import base64
import os
import json
import logging
from openai import OpenAI
from dotenv import load_dotenv
_ = load_dotenv()

logger = logging.getLogger(__name__)
openai_client = OpenAI()


def setup_logger():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)


def query_openai_model(system_msg, prompt, screenshot, num_outputs):
    # base64_image = encode_image(screenshot_path)
    base64_image = base64.b64encode(screenshot).decode('utf-8')

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user",
             "content": [
                 {"type": "text", "text": prompt},
                 {"type": "image_url",
                  "image_url": {
                      "url": f"data:image/jpeg;base64,{base64_image}",
                      "detail": "high"
                  }
                  }
             ]
             },
        ],
        n=num_outputs
    )

    answer: list[str] = [x.message.content for x in response.choices]
    return answer


def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')


def search_interactive_elements(interactive_elements, extracted_number):
    for element in interactive_elements:
        if element.get('bid') == extracted_number:
            return {
                'text': element.get('text'),
                'type': element.get('type'),
                'tag': element.get('tag'),
                'id': element.get('id'),
                'href': element.get('href'),
                'title': element.get('title'),
                'ariaLabel': element.get('ariaLabel')
            }
    return {}  # Return empty dictionary if no matching element is found

def locate_element(page, extracted_number):
    # Define selectors for potentially interactive elements
    selectors = [
        'a', 'button', 'input', 'select', 'textarea', 'summary', 'video', 'audio',
        'iframe', 'embed', 'object', 'menu', 'label', 'fieldset', 'datalist', 'output',
        'details', 'dialog', 'option', '[role="button"]', '[role="link"]', '[role="checkbox"]',
        '[role="radio"]', '[role="menuitem"]', '[role="tab"]', '[tabindex]', '[contenteditable="true"]'
    ]

    # Combine selectors into a single string
    combined_selector = ', '.join(selectors)

    # Find all potentially interactive elements
    elements = page.query_selector_all(combined_selector)

    for element in elements:
        bid = element.get_attribute('data-unique-test-id') or element.get_attribute('id') or ''

        if bid == extracted_number:
            result = {
                'text': element.inner_text(),
                'type': element.get_attribute('type'),
                'tag': element.evaluate('el => el.tagName.toLowerCase()'),
                'id': element.get_attribute('id'),
                'href': element.get_attribute('href'),
                'title': element.get_attribute('title'),
                'ariaLabel': element.get_attribute('aria-label'),
                'name': element.get_attribute('name'),
                'value': element.get_attribute('value'),
                'placeholder': element.get_attribute('placeholder'),
                'class': element.get_attribute('class'),
                'role': element.get_attribute('role'),
            }

            return result

    return {}  # Return empty dictionary if no matching element is found

def parse_function_args(function_args):
    if not function_args or not isinstance(function_args, list):
        return None
    first_arg = function_args[0]
    return first_arg if isinstance(first_arg, str) and first_arg.replace('.', '', 1).isdigit() else None


def append_to_steps_json(result, file_path):
    json_line = json.dumps(result)
    with open(file_path, 'a') as file:
        file.write(json_line + '\n')
    print(f"Appended result to {file_path}")
