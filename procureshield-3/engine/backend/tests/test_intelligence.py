from backend.intelligence import check_eligibility, extract_requirements


def test_extract_requirements():
    result = extract_requirements("TENDER RFP\nMinimum 3 years experience. Valid GST registration. PAN card required.")
    assert result["required_documents"]
    assert any(x["type"] == "experience" for x in result["eligibility_requirements"])


def test_check_eligibility():
    tender = {
        "eligibility_requirements": [
            {"requirement": "Minimum 3 years experience", "type": "experience"},
            {"requirement": "Valid GST registration", "type": "tax"},
        ],
        "required_documents": ["GST certificate"],
    }
    bidder = {"years_experience": 5, "gstin": "22ABCDE1234F1Z5", "documents": ["GST certificate"]}
    result = check_eligibility(tender, bidder)
    assert result["status"] == "Pre-check Passed"
    assert result["eligibility_score"] == 100
