"""Check exported evidence against original rollouts and independent history."""
import collections
import csv
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent
HOME = Path.home() / '.codex'


def unescape(text):
    return re.sub(r'\\([\\nrt])', lambda m: {'\\': '\\', 'n': '\n', 'r': '\r', 't': '\t'}[m[1]], text)


def rows(name, escaped=False):
    with (OUT / name).open(encoding='utf-8-sig', newline='') as f:
        result = list(csv.DictReader(f, delimiter='\t'))
    assert all(None not in r for r in result), name
    assert len((OUT / name).read_text(encoding='utf-8-sig').splitlines()) == len(result) + 1, name
    return [{k: unescape(v) for k, v in r.items()} for r in result] if escaped else result


manifest = json.loads((OUT / 'source_manifest.json').read_text())
sources = {}
for s in manifest['sources']:
    with Path(s['rollout_path']).open('rb') as f:
        data = f.read(s['bytes'])
    assert hashlib.sha256(data).hexdigest() == s['sha256']
    sources[s['rollout_path']] = [json.loads(line) for line in data.decode().splitlines()]
users = rows('instructions.tsv', True)
questions = rows('question_answers.tsv', True)
for row in users:
    raw = sources[row['source_path']][int(row['source_line']) - 1]['payload']
    assert raw['role'] == 'user'
    assert row['text'] == '\n'.join(c.get('text', '') for c in raw['content'])
for row in questions:
    raw = sources[row['source_path']][int(row['source_line']) - 1]['payload']
    assert raw['call_id'] == row['call_id']
    question = next(q for q in json.loads(raw['arguments'])['questions'] if q['id'] == row['question_id'])
    assert question['question'] == row['question']
    assert question['options'] == json.loads(row['options'])
    result = sources[row['source_path']][int(row['result_line']) - 1]['payload']
    assert result['call_id'] == row['call_id']
    assert result['output'] == row['raw_result']
    try:
        vals = json.loads(result['output']).get('answers', {}).get(row['question_id'], {}).get('answers', [])
    except json.JSONDecodeError:
        vals = []
    assert vals == json.loads(row['answer_values'])
    assert [v for v in vals if not v.startswith('user_note: ')] == json.loads(row['selected_values'])
    assert [v[len('user_note: '):] for v in vals if v.startswith('user_note: ')] == json.loads(row['user_notes'])

session_ids = {s['id'] for s in manifest['sources']}
history_rows = []
history_data = (HOME / 'history.jsonl').read_bytes()
for line in history_data.splitlines():
    row = json.loads(line)
    if row.get('session_id') in session_ids:
        history_rows.append(row)
rollout_counter = collections.Counter((r['session_id'], r['text']) for r in users)
history_counter = collections.Counter((r['session_id'], r['text']) for r in history_rows)
exact_matches = sum((rollout_counter & history_counter).values())
def normalize_skill_link(text):
    return re.sub(r'\[(\$grade-informed-etd-decision-support)\]\(/Users/minaph/Projects/grade-informed-etd-decision-support/SKILL\.md\)', r'\1', text)
assert collections.Counter((r['session_id'], normalize_skill_link(r['text'])) for r in users) == collections.Counter((r['session_id'], normalize_skill_link(r['text'])) for r in history_rows)
history_variants = []
for (sid, text), count in (history_counter - rollout_counter).items():
    match = next(r for r in users if r['session_id'] == sid and normalize_skill_link(r['text']) == normalize_skill_link(text))
    history_variants.append({'instruction_id': match['instruction_id'], 'session_id': sid, 'reason': 'history.jsonl expands a named skill to a local Markdown link', 'history_text': text, 'rollout_text': match['text'], 'occurrences': count})
c = sqlite3.connect(f'file:{HOME}/thread_history_1.sqlite?mode=ro', uri=True)
db_counts = {sid: c.execute("SELECT count(*) FROM thread_items WHERE thread_id=? AND item_type='userMessage'", (sid,)).fetchone()[0] for sid in session_ids}
c.close()
assert dict(collections.Counter(r['session_id'] for r in users)) == db_counts

all_ids = {r['instruction_id'] for r in users} | {r['answer_id'] for r in questions}
summary = rows('instruction_summary.tsv')
assert {x for r in summary for x in r['evidence_ids'].split(',')} == {r['instruction_id'] for r in users}
decisions = rows('decision_summary.tsv')
for row in decisions:
    assert set(row['evidence_ids'].split(',')) <= all_ids, row
    for ref in row['artifact_refs'].split(';'):
        path, _, lineno = ref.partition(':')
        target = OUT / path if path.endswith('.tsv') else ROOT / path
        assert target.exists(), ref
        if lineno:
            assert 0 < int(lineno) <= len(target.read_text().splitlines()), ref

for p in OUT.glob('*.md'):
    text = p.read_text()
    assert sum(line.startswith('```') for line in text.splitlines()) % 2 == 0, p
    for identifier in re.findall(r'\b[UQ]\d{3}\b', text):
        assert identifier in all_ids, (p, identifier)
    for link in re.findall(r'\]\(([^)]+)\)', text):
        assert (p.parent / link.split('#')[0]).exists(), (p, link)

stats = json.loads((OUT / 'extraction_stats.json').read_text())
assert len(users) == stats['user_occurrences']
assert len(questions) == stats['questions']
assert dict(collections.Counter(q['answer_status'] for q in questions)) == stats['answer_status_counts']
result = {
    'checked_at_jst': dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(),
    'code_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'source_prefix_hashes': 'passed',
    'instruction_verbatim_matches': len(users),
    'question_options_answer_verbatim_matches': len(questions),
    'history_jsonl_exact_session_and_text_multiset_matches': exact_matches,
    'history_jsonl_matches_after_named_skill_link_normalization': len(history_rows),
    'history_text_variants': history_variants,
    'thread_history_db_user_message_count_matches': sum(db_counts.values()),
    'instruction_summary_coverage': 'all 27 occurrences',
    'decision_summary_evidence_ids_and_file_lines': 'passed',
    'markdown_links_fences_evidence_ids': 'passed',
    'tsv_single_physical_line_per_record': 'passed',
    'stats': stats,
    'application_tests_rerun': False,
}
(OUT / 'validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
