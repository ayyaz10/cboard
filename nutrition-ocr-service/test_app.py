import asyncio
import io
import unittest
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers

import app


class FakeResult:
    json = {"res": {"input_path": "temporary-path", "parsing_res_list": []}}


class FakePipeline:
    path = None

    def predict(self, input):
        self.path = Path(input)
        return [FakeResult()]


def png_bytes():
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, format="PNG")
    return buffer.getvalue()


class NutritionOcrServiceTests(unittest.TestCase):
    def setUp(self):
        self.original_pipeline = app.pipeline
        self.original_auth = app.os.environ.get("NUTRITION_OCR_REQUIRE_AUTH")
        app.os.environ["NUTRITION_OCR_REQUIRE_AUTH"] = "false"
        app.pipeline = FakePipeline()

    def tearDown(self):
        app.pipeline = self.original_pipeline
        if self.original_auth is None:
            app.os.environ.pop("NUTRITION_OCR_REQUIRE_AUTH", None)
        else:
            app.os.environ["NUTRITION_OCR_REQUIRE_AUTH"] = self.original_auth

    def upload(self, data):
        return UploadFile(
            filename="label.png",
            file=io.BytesIO(data),
            headers=Headers({"content-type": "image/png"}),
        )

    def test_valid_image_returns_structured_output_and_deletes_temporary_photo(self):
        response = asyncio.run(app.nutrition_ocr(self.upload(png_bytes())))
        self.assertEqual(response["provider"]["model"], "PaddleOCR-VL-1.6-0.9B")
        self.assertNotIn("input_path", response["document"]["res"])
        self.assertFalse(app.pipeline.path.exists())

    def test_invalid_image_is_rejected_and_temporary_file_is_deleted(self):
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(app.nutrition_ocr(self.upload(b"not an image")))
        self.assertEqual(raised.exception.status_code, 400)

    def test_unconfigured_model_returns_service_unavailable(self):
        app.pipeline = None
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(app.nutrition_ocr(self.upload(png_bytes())))
        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
