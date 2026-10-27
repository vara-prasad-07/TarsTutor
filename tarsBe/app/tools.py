import ast
import math
import operator

from langchain.tools import tool

from .models import Calculation, Feedback, QuestionDraft


def expression_value(expression: str) -> float:
    """Evaluate a tiny arithmetic grammar, with strict computation bounds."""
    tree = ast.parse(expression, mode="eval")
    if len(list(ast.walk(tree))) > 50:
        raise ValueError("Expression is too complex")
    binary = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: operator.pow}

    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            value = float(node.value)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = visit(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.BinOp) and type(node.op) in binary:
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 100:
                raise ValueError("Exponent exceeds limit")
            value = binary[type(node.op)](left, right)
        else:
            raise ValueError("Only numbers and + - * / ** parentheses are supported")
        if isinstance(value, complex) or not math.isfinite(value) or abs(value) > 1e12:
            raise ValueError("Result exceeds numeric limits")
        return value

    return visit(tree.body)


@tool(args_schema=Calculation)
def calculate(operation: str, expression: str = "", value: float = 0) -> dict:
    """Calculate constrained arithmetic or sigmoid values; never execute code."""
    try:
        if operation == "sigmoid":
            result = 1 / (1 + math.exp(-value)) if value >= 0 else math.exp(value) / (1 + math.exp(value))
        elif operation == "expression":
            result = expression_value(expression)
        else:
            raise ValueError("Unknown operation")
        return {"ok": True, "value": result}
    except (ValueError, SyntaxError, ArithmeticError, TypeError):
        return {"ok": False, "error": "Unsupported or invalid calculation"}


def check_answer(question_id: str, question: QuestionDraft, answer: str) -> Feedback:
    if question.kind == "numeric":
        try:
            number = float(answer)
            correct = math.isfinite(number) and math.isclose(number, question.expected_number, rel_tol=0, abs_tol=question.tolerance)
        except ValueError:
            return Feedback(question_id=question_id, correct=None, message="Please submit a number without units for this question.")
    else:
        # Choice answers use exact choice text or a zero-based index.
        if answer in question.choices:
            selected = question.choices.index(answer)
        elif answer in [str(i) for i in range(len(question.choices))]:
            selected = int(answer)
        else:
            return Feedback(question_id=question_id, correct=None, message="Select a listed choice or send its zero-based index.")
        correct = selected == question.correct_index
    return Feedback(question_id=question_id, correct=correct, message="Correct." if correct else "Try another step; this answer does not match the expected result.")
