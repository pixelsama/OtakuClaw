from fastapi.testclient import TestClient

import main


def test_metrics_endpoint_exposes_prometheus_data():
    with TestClient(main.app) as client:
        response = client.get("/metrics")
        assert response.status_code == 200
        body = response.text
        assert "bilibili_connection_status" in body
