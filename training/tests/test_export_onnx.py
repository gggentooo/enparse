"""
training/tests/test_export_onnx.py — integration test for export_onnx.py

Description:
    Saves a tiny randomly initialized BERT (conftest fixtures) like a
    train.py checkpoint, runs the full export (fp32, int8, fp16), and checks
    the output folder: files, onnx.checker, logits width, onnxruntime vs
    PyTorch agreement, labels.json `files`, reference.json, parity inputs.

Phase: 7 — smoke-test export (pre-work); 9 — export and quantization.

Dependencies:
    Python: pytest, optimum-onnx, onnx, onnxruntime, transformers;
            scripts/export_onnx.py, scripts/prepare_data.py.

Status: implemented (Phase 7 pre-work).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from export_onnx import VARIANT_FILES, dev_windows, export, sha256
from prepare_data import validate_labels_json

if TYPE_CHECKING:
    from transformers import PreTrainedModel, PreTrainedTokenizerBase

EXPORT_CFG = {
    "opset": 18,
    "variants": ["fp32", "int8", "fp16"],
    "int8_per_channel": False,
    "int8_exclude_nodes": [],
    "fp16_keep_io_types": True,
}
SENTENCES = ["the red dog barks loudly .", "a cat sleeps ."]


def test_export_tiny_model(
    tiny: dict[str, Any],
    tokenizer: PreTrainedTokenizerBase,
    tiny_model_factory: Callable[[int], PreTrainedModel],
    tmp_path: Path,
) -> None:
    labels_json = tiny["labels_json"]
    model = tiny_model_factory(len(labels_json["labels"]))
    model.config.id2label = dict(enumerate(labels_json["labels"]))
    model.config.label2id = {lab: i for i, lab in enumerate(labels_json["labels"])}
    best = tmp_path / "best"
    model.save_pretrained(best)
    tokenizer.save_pretrained(best)
    (best / "labels.json").write_text(json.dumps(labels_json))

    out = tmp_path / "onnx"
    report = export(best, out, EXPORT_CFG, SENTENCES, dev_windows(tiny["dev"], None))

    for v, rel in VARIANT_FILES.items():
        assert (out / rel).exists(), v
        assert report["checker"][v] == "ok"
        r = report["variants"][v]
        assert r["logits_width_ok"]
    # fp32 matches PyTorch exactly; quantized variants may differ on a random model.
    assert report["variants"]["fp32"]["reference_agreement"] == {"chunk": 1.0, "dep": 1.0}
    assert report["variants"]["fp32"]["dev_agreement"] == {"chunk": 1.0, "dep": 1.0}

    shipped = json.loads((out / "labels.json").read_text())
    assert validate_labels_json(shipped) == []
    files = shipped["files"]
    assert "config.json" in files
    assert VARIANT_FILES["int8"] in files and VARIANT_FILES["fp16"] in files
    assert VARIANT_FILES["fp32"] not in files
    assert not any(
        name in files for name in ("reference.json", "parity_inputs.jsonl", "labels.json")
    )
    for rel, meta in files.items():
        assert meta["bytes"] == (out / rel).stat().st_size
        assert meta["sha256"] == sha256(out / rel)

    ref = json.loads((out / "reference.json").read_text())
    assert [s["words"] for s in ref["sentences"]] == [s.split() for s in SENTENCES]
    first = ref["sentences"][0]
    assert first["token_word"][0] == -1 and first["token_word"][-1] == -1
    assert len(first["torch_chunk_ids"]) == len(first["words"])
    parity = (out / "parity_inputs.jsonl").read_text().strip().split("\n")
    assert len(parity) == len(tiny["dev"])


def test_topo_sort_orders_nodes_and_subgraph_reads(tmp_path: Path) -> None:
    import onnx
    from onnx import TensorProto, helper

    from export_onnx import topo_sort

    # Main graph: x → a (Identity) → If(cond) whose branches read `a` from the outer scope.
    then_g = helper.make_graph(
        [helper.make_node("Identity", ["a"], ["t"])], "then", [],
        [helper.make_tensor_value_info("t", TensorProto.FLOAT, [1])],
    )  # fmt: skip
    else_g = helper.make_graph(
        [helper.make_node("Identity", ["a"], ["e"])], "else", [],
        [helper.make_tensor_value_info("e", TensorProto.FLOAT, [1])],
    )  # fmt: skip
    if_node = helper.make_node("If", ["cond"], ["y"], then_branch=then_g, else_branch=else_g)
    a_node = helper.make_node("Identity", ["x"], ["a"])
    graph = helper.make_graph(
        [if_node, a_node],  # wrong order: If reads `a` (inside its branches) before it exists
        "g",
        [
            helper.make_tensor_value_info("x", TensorProto.FLOAT, [1]),
            helper.make_tensor_value_info("cond", TensorProto.BOOL, []),
        ],
        [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])],
    )
    path = tmp_path / "m.onnx"
    onnx.save(helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)]), str(path))
    assert topo_sort(path) is True
    sorted_model = onnx.load(str(path))
    assert [n.op_type for n in sorted_model.graph.node] == ["Identity", "If"]
    onnx.checker.check_model(sorted_model)
    assert topo_sort(path) is False  # already sorted


def test_reference_has_margins(tmp_path: Path) -> None:
    # Margins are written next to the argmax ids (used by the smoke check).
    import numpy as np

    from export_onnx import word_margins
    from metrics import LabelSpace

    space = LabelSpace(["A|O", "B|O", "0@ROOT|root", "+1@X|dep"], 0, 2, 2, 4)
    logits = np.array([[0, 0, 0, 0], [1.0, 3.0, 0.5, 0.0]], dtype=np.float32)
    assert word_margins(logits, [-1, 0], space) == ([2.0], [0.5])
