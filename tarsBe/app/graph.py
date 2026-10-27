from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langchain_core.exceptions import OutputParserException
from pydantic import ValidationError

from .models import Classification, Draft, Plan, Review, TurnRequest
from .provider import Provider
from .tools import calculate, check_answer


class State(TypedDict, total=False):
    request: TurnRequest
    context: dict
    classification: Classification
    plan: Plan
    evidence: list[dict]
    draft: Draft | None
    feedback: dict | None
    issues: list[str]
    rounds: int
    repairs: int
    trace: list[str]
    status: str


def build_graph(provider: Provider):
    def payload(state):
        return {
            "request": state["request"].model_dump(),
            "session": state["context"],
            "classification": state["classification"].model_dump() if state.get("classification") else None,
            "plan": state["plan"].model_dump() if state.get("plan") else None,
            "tool_results": state.get("evidence", []),
            "feedback": state.get("feedback"),
        }

    async def classify(state):
        request = state["request"]
        if request.answer_to_question_id:
            classification = Classification(intent="answer_submission", needs_clarification=False, clarification="")
        elif request.action == "review_work" and not request.board_context.selected_text:
            classification = Classification(intent="review_work", needs_clarification=True, clarification="Select your written work as text and submit it for review. Image and handwriting review is not available yet.")
        else:
            classification = await provider.generate(Classification,
                "Classify the student's intent using recent conversation and selected board text. "
                "new_topic means a new learning topic, exercise, or practice-question request; "
                "follow_up means continuing the current concept. off_topic means unrelated to learning, "
                "not merely a change of school subject. A request for arithmetic practice is educational. "
                "For an unresolved reference or missing work, set needs_clarification and ask one specific question. "
                "Image, handwriting, web research, and document retrieval tools are unavailable; clarify requests needing these. "
                "Arithmetic and sigmoid calculations ARE available through a calculator, and the app renders "
                "structured text/formula lessons on its board. Do not ask permission to use these capabilities. "
                "Do not ask for grade level if a useful beginner explanation is possible.", payload(state))
        feedback = None
        if request.answer_to_question_id:
            question = state["context"]["active_question"]
            from .models import QuestionDraft
            feedback = check_answer(request.answer_to_question_id, QuestionDraft.model_validate(question["key"]), request.message).model_dump()
        return {"classification": classification, "feedback": feedback, "trace": ["classify"] + (["check_answer"] if feedback else [])}

    def clarify(state):
        return {"draft": Draft(reply=state["classification"].clarification or "Which part would you like me to explain?"), "status": "clarification", "trace": state["trace"] + ["clarify"]}

    async def plan(state):
        result = await provider.generate(Plan,
            "Plan 1-3 concise teaching steps and testable acceptance criteria. Request calculations "
            "only if needed; expression supports numbers, + - * / ** and parentheses; sigmoid accepts value. "
            "Use existing tool results; do not repeat calculations. After two tool rounds, calculations must be empty. "
            "For answer submissions use authoritative feedback. Never claim unavailable tool access.",
            {**payload(state), "tool_rounds_remaining": 2 - state.get("rounds", 0)})
        return {"plan": result, "trace": state["trace"] + ["plan"]}

    async def tools(state):
        evidence = list(state.get("evidence", []))
        for call in state["plan"].calculations:
            result = await calculate.ainvoke(call.model_dump())
            evidence.append({"tool": "calculate", "input": call.model_dump(), "result": result})
        return {"evidence": evidence, "rounds": state.get("rounds", 0) + 1, "trace": state["trace"] + ["tools"]}

    async def draft(state):
        try:
            result = await provider.generate(Draft,
                "Write the response following the plan and tool evidence. Use lesson only when board teaching helps. "
                "Keep text within the schema limits; use text/formula blocks only. lesson.reply must equal reply. "
                "Optionally add one numeric or choice question with a private answer key, only if useful. "
                "Do not include an answer key in public text. Numeric questions must specify expected units in prompt. "
                "Use authoritative feedback and do not override it. Do not invent evidence when a tool fails. "
                "Fix every supplied validation issue.", {**payload(state), "validation_issues": state.get("issues", [])})
            return {"draft": result, "issues": [], "trace": state["trace"] + ["draft"]}
        except (ValidationError, OutputParserException):
            return {"draft": None, "issues": ["Response violated output schema; shorten and correct fields."], "trace": state["trace"] + ["draft_invalid"]}

    async def validate(state):
        result = state.get("draft")
        issues = list(state.get("issues", []))
        if result:
            if result.lesson and result.lesson.reply != result.reply:
                issues.append("Lesson reply must match chat reply.")
            review = await provider.generate(Review,
                "Review factual/mathematical correctness, alignment with intent and plan criteria, "
                "use of tool results, authoritative answer feedback, and teaching clarity. Check question keys "
                "and ensure no private answer is revealed. Flag unsupported claims of image/web access. "
                "Return passed=false with concrete issues for errors; do not rewrite the draft.",
                {**payload(state), "draft": result.model_dump()})
            if not review.passed or review.issues:
                issues.extend(review.issues or ["Semantic review failed; correct factual and teaching errors."])
        return {"issues": issues, "trace": state["trace"] + ["validate"], "status": "completed" if not issues else "fallback"}

    def repair(state):
        return {"repairs": state.get("repairs", 0) + 1, "trace": state["trace"] + ["repair"]}

    def fallback(state):
        return {"draft": Draft(reply="I could not verify a reliable explanation for this turn. Please narrow the question or share the step you want help with."), "status": "fallback", "trace": state["trace"] + ["fallback"]}

    graph = StateGraph(State)
    for name, node in [("classify", classify), ("clarify", clarify), ("plan", plan), ("tools", tools), ("draft", draft), ("validate", validate), ("repair", repair), ("fallback", fallback)]:
        graph.add_node(name, node)
    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", lambda s: "clarify" if s["classification"].needs_clarification else "plan")
    graph.add_edge("clarify", END)
    graph.add_conditional_edges("plan", lambda s: "tools" if s["plan"].calculations and s.get("rounds", 0) < 2 else "draft")
    graph.add_edge("tools", "plan")
    graph.add_edge("draft", "validate")
    graph.add_conditional_edges("validate", lambda s: END if not s["issues"] else "repair" if s.get("repairs", 0) < 1 else "fallback")
    graph.add_edge("repair", "draft")
    graph.add_edge("fallback", END)
    return graph.compile()
