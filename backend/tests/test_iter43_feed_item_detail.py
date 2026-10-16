"""Backend tests for Daily Wellness Feed item detail (iter 43).

Covers GET /api/feed and GET /api/feed/{id} introduced to back the new
patient feed detail screen (app/feed-item/[id].tsx).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://swasth-daily.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def feed_items(api_client):
    r = api_client.get(f"{BASE_URL}/api/feed", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list) and len(data) > 0, "Feed list must be non-empty"
    return data


# ---------- /api/feed listing ----------
class TestFeedList:
    def test_feed_list_shape(self, feed_items):
        sample = feed_items[0]
        # Fields the mobile feed card relies on
        for key in ("id", "title", "body", "category"):
            assert key in sample, f"missing {key} in {sample}"
        assert sample["category"] in {"tip", "remedy", "yoga"}, f"unexpected cat {sample['category']}"

    def test_feed_contains_all_three_categories(self, feed_items):
        cats = {i.get("category") for i in feed_items}
        assert {"tip", "remedy", "yoga"}.issubset(cats), f"got {cats}"


# ---------- /api/feed/{id} detail ----------
class TestFeedItemDetail:
    def test_detail_ok_item_2(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/feed/2", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert str(d["id"]) == "2"
        assert d["category"] == "remedy"
        assert d["title"] and d["body"]
        assert "related" in d and isinstance(d["related"], list)
        # related must not contain itself & must share category
        for r_item in d["related"]:
            assert str(r_item["id"]) != "2"
            assert r_item["category"] == "remedy"
        assert len(d["related"]) <= 4

    def test_detail_404_for_missing(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/feed/nope", timeout=30)
        assert r.status_code == 404
        assert r.json().get("detail")

    def test_detail_tip_has_related(self, api_client, feed_items):
        tip = next(i for i in feed_items if i["category"] == "tip")
        r = api_client.get(f"{BASE_URL}/api/feed/{tip['id']}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        # There are >= 2 tips in seed data, so related should contain siblings
        assert len(d["related"]) >= 1, f"expected tip to have related siblings, got {d['related']}"
        assert all(x["category"] == "tip" for x in d["related"])

    def test_detail_persists_all_fields_for_frontend(self, api_client):
        """The detail screen (app/feed-item/[id].tsx) reads title, body, category,
        image_url and related[].{id,title,body,image_url}. Verify shape."""
        r = api_client.get(f"{BASE_URL}/api/feed/1", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("title", "body", "category", "image_url", "related"):
            assert k in d, f"missing {k}"
        for rel in d["related"]:
            for k in ("id", "title", "body"):
                assert k in rel, f"missing {k} in related item"

    def test_no_mongo_object_id_leaked(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/feed/2", timeout=30)
        d = r.json()
        assert "_id" not in d
        for rel in d.get("related", []):
            assert "_id" not in rel
