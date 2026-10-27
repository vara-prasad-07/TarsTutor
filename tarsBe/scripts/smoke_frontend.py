"""Opt-in browser test against the running frontend and real Gemini backend."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def main():
    target = os.environ.get("TUTOR_FRONTEND_URL", "http://127.0.0.1:3001")
    artifacts = ROOT / "data" / "browser-test"
    artifacts.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_default_timeout(20000)
        page.goto(target, wait_until="domcontentloaded", timeout=90000)
        expect(page.get_by_role("button", name="Send to tutor", exact=True)).to_be_visible(timeout=90000)
        prompt = "Explain Newton's second law with mass 2 kg and acceleration 3 m/s². Use the calculator and show a board lesson. Also ask exactly this numeric practice question in the question field: What is 3 + 4? Do not reveal the answer to the practice question."
        page.get_by_label("Your question", exact=True).fill(prompt)
        with page.expect_response(lambda response: "/api/tutor/sessions/" in response.url and response.url.endswith("/turns") and response.request.method == "POST", timeout=195000) as pending:
            page.get_by_role("button", name="Send to tutor", exact=True).click()
        response = pending.value
        result = response.json()
        print(json.dumps({"step": "lesson", "http": response.status, "status": result.get("status"), "has_lesson": bool(result.get("lesson")), "has_question": bool(result.get("question"))}), flush=True)
        assert response.status == 200 and result["status"] == "completed", result
        assert result["lesson"] and result["question"]
        expect(page.get_by_role("region", name="Practice question")).to_be_visible()
        expect(page.get_by_text(result["reply"], exact=True)).to_be_visible()
        page.screenshot(path=str(artifacts / "lesson.png"))
        page.get_by_role("button", name="Close conversation", exact=True).click()
        page.wait_for_timeout(1200)  # Allow the known viewport animation to settle for capture.
        page.screenshot(path=str(artifacts / "board.png"))
        page.reload(wait_until="domcontentloaded")
        page.get_by_role("button", name="Conversation", exact=True).click()
        expect(page.get_by_label("Your answer", exact=True)).to_be_enabled(timeout=30000)
        expect(page.get_by_text(prompt, exact=True)).to_be_visible()
        print(json.dumps({"step": "reload", "restored": True}), flush=True)
        page.get_by_label("Your answer", exact=True).fill("7")
        with page.expect_response(lambda response: response.url.endswith("/turns") and response.request.method == "POST", timeout=195000) as pending:
            page.get_by_role("button", name="Check answer", exact=True).click()
        graded = pending.value.json()
        assert graded["feedback"]["correct"] is True, graded
        expect(page.get_by_text("Correct: Correct.", exact=True)).to_be_visible()
        page.screenshot(path=str(artifacts / "answer.png"))
        # No secret headers should be present on browser requests to the local proxy.
        assert "x-api-key" not in pending.value.request.headers
        print(json.dumps({"step": "answer", "correct": True, "browser_credentials": False}), flush=True)
        print(json.dumps({"status": "PASS", "frontend": target, "artifacts": str(artifacts)}), flush=True)
        browser.close()


if __name__ == "__main__":
    main()
