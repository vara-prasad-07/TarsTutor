"""HTTP integration check through Vite's real API proxy; no browser automation.

Requires both local services. Creates one saved linear-regression lesson and
keeps public verification artifacts in ignored data/verification (no keys).
"""
import base64
import io
import json
import os
import sys
import time
from pathlib import Path
from uuid import uuid4

import httpx
from pypdf import PdfWriter

ROOT = Path(__file__).resolve().parents[1]

def main():
    target = os.environ.get("TUTOR_FRONTEND_URL", "http://127.0.0.1:3001")
    artifacts = ROOT / "data" / "verification"
    artifacts.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url=target, timeout=195) as client:
        for route in ("/", "/lesson/generating/test", "/lesson/test", "/board"):
            response = client.get(route)
            assert response.status_code == 200 and "TarsTutor" in response.text
        # Verify PDF extraction independently, including a readable generated PDF.
        document = PdfWriter()
        page = document.add_blank_page(width=200, height=200)
        from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
        font = DictionaryObject({NameObject("/Type"):NameObject("/Font"),NameObject("/Subtype"):NameObject("/Type1"),NameObject("/BaseFont"):NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"):font})})
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 12 Tf 10 100 Td (Scores rise by six per study hour.) Tj ET")
        page[NameObject("/Contents")] = content
        buffer=io.BytesIO();document.write(buffer)
        uploaded=client.post("/api/tutor/uploads",json={"name":"study-notes.pdf","media_type":"application/pdf","data":base64.b64encode(buffer.getvalue()).decode()})
        assert uploaded.status_code == 200, uploaded.text
        assert "six per study hour" in uploaded.json()["text"]
        sid=f"verified-{uuid4().hex[:12]}"
        body={"session_id":sid,"prompt":"Teach me linear regression from scratch. Plot study hours against test scores, use y = 45 + 6x, predict the score at x = 3, explain residuals, and include quizzes.","materials":[uploaded.json()]}
        response=client.post("/api/tutor/lessons",json=body)
        assert response.status_code == 202,response.text
        started=time.monotonic();first=None;seen=[]
        while time.monotonic()-started<300:
            response=client.get(f"/api/tutor/lessons/{sid}")
            response.raise_for_status();lesson=response.json()
            if lesson["stage"] not in seen:
                seen.append(lesson["stage"])
                print(json.dumps({"stage":lesson["stage"]}),flush=True)
            if lesson["segments"] and first is None:first=round(time.monotonic()-started,1)
            if not lesson["generating"]:break
            time.sleep(.5)
        assert lesson["status"]=="completed",lesson.get("error")
        assert any(e["type"]=="graph" for s in lesson["segments"] for e in s["elements"])
        assert any("63" in s["narration"] or any("63" in e["text"] for e in s["elements"]) for s in lesson["segments"]),"Worked prediction was missing"
        assert client.post("/api/tutor/lessons",json=body).json()["segments"]==lesson["segments"]
        segment=lesson["segments"][0]
        audio=client.post("/api/tutor/speech/tts",json={"text":segment["narration"]})
        assert audio.status_code==200,audio.text[:200]
        assert audio.content[:4]==b"RIFF" and float(audio.headers["x-audio-duration"])>0
        (artifacts/"lesson-narration.wav").write_bytes(audio.content)
        short=client.post("/api/tutor/speech/tts",json={"text":"Can you explain slope with a real life example?"})
        assert short.status_code==200
        stt=client.post("/api/tutor/speech/stt",content=short.content,headers={"Content-Type":"audio/wav"})
        assert stt.status_code==200 and stt.json()["text"],stt.text
        question={"request_id":uuid4().hex,"segment_id":segment["id"],"message":stt.json()["text"]}
        answer=client.post(f"/api/tutor/lessons/{sid}/questions",json=question)
        assert answer.status_code==200 and answer.json()["narration"],answer.text
        answer_audio=client.post("/api/tutor/speech/tts",json={"text":answer.json()["narration"]})
        assert answer_audio.status_code==200
        quiz=segment["quiz"]
        submission="0" if quiz["kind"] in ("numeric","choice") else "slope"
        grade=client.post(f"/api/tutor/lessons/{sid}/answers",json={"request_id":uuid4().hex,"question_id":quiz["id"],"answer":submission})
        assert grade.status_code==200 and grade.json()["correct"] is not None,grade.text
        restored=client.get(f"/api/tutor/lessons/{sid}").json()
        assert len(restored["conversation"])==2
        assert all(private not in json.dumps(restored) for private in ("correct_index","expected_number","accepted_answers"))
        (artifacts/"linear-regression.json").write_text(json.dumps(restored,ensure_ascii=False,indent=2),encoding="utf-8")
        report={"status":"PASS","frontend":target,"classroom":f"{target}/lesson/{sid}","segments":len(lesson["segments"]),"first_segment_seconds":first,"routes":True,"pdf":True,"tts":True,"stt":True,"spoken_contextual_answer":True,"quiz":True,"restore":True,"idempotency":True}
        (artifacts/"http-flow.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
        print(json.dumps(report),flush=True)
    return 0

if __name__=="__main__":sys.exit(main())
