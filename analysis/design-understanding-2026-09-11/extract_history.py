"""Extract project user statements and synchronous question results, read-only.

TSV cells escape backslash, TAB, CR and LF so every record occupies one line.
The manifest freezes source byte prefixes; reruns never include later turns.
"""
import collections
import csv
import datetime as dt
import hashlib
import json
from pathlib import Path
import sqlite3

OUT = Path(__file__).resolve().parent
HOME = Path.home() / '.codex'
CURRENT = '01a08e13-6691-7d41-b129-b914a9c8092b'


def dump(name, rows, fields):
    def cell(v):
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False, separators=(',', ':'))
        return str(v if v is not None else '').replace('\\', '\\\\').replace('\t', '\\t').replace('\r', '\\r').replace('\n', '\\n')
    with (OUT / name).open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, delimiter='\t', lineterminator='\n')
        w.writerow(fields)
        for row in rows:
            w.writerow([cell(row.get(k, '')) for k in fields])


def jst(timestamp):
    return dt.datetime.fromisoformat(timestamp.replace('Z', '+00:00')).astimezone(dt.timezone(dt.timedelta(hours=9))).isoformat()


manifest_path = OUT / 'source_manifest.json'
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text())
else:
    c = sqlite3.connect(f'file:{HOME}/state_5.sqlite?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    candidates = [dict(r) for r in c.execute("SELECT id,rollout_path,cwd,title,source FROM threads WHERE (cwd LIKE '%jsPsych-demo%' OR title LIKE '%jsPsych%') AND source='cli'")]
    c.close()
    sources = []
    for r in candidates:
        if r['id'] == CURRENT:
            continue
        p = Path(r['rollout_path'])
        data = p.read_bytes()
        r.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        sources.append(r)
    manifest = {'created_at_jst': dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(), 'excluded_current_session': CURRENT, 'sources': sources}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

users, calls, contexts, sessions = [], [], [], []
for source in manifest['sources']:
    path = Path(source['rollout_path'])
    with path.open('rb') as f:
        data = f.read(source['bytes'])
    assert hashlib.sha256(data).hexdigest() == source['sha256'], path
    pending = {}
    previous_assistant = ''
    session_users = 0
    for lineno, line in enumerate(data.decode().splitlines(), 1):
        obj = json.loads(line)
        if obj['type'] != 'response_item':
            continue
        p = obj['payload']
        base = {'session_id': source['id'], 'source_path': str(path), 'source_line': lineno, 'ordinal': obj.get('ordinal', ''), 'timestamp_utc': obj['timestamp'], 'timestamp_jst': jst(obj['timestamp'])}
        if p.get('type') == 'message':
            text = '\n'.join(x.get('text', '') for x in p.get('content', []))
            if p.get('role') == 'assistant':
                previous_assistant = text
            elif p.get('role') == 'user':
                if text.startswith(('# AGENTS.md', '<skill>', '<environment_context>')):
                    contexts.append({**base, 'kind': 'injected_context', 'text': text})
                else:
                    users.append({**base, 'message_id': p.get('id', ''), 'text': text, 'preceding_assistant': previous_assistant})
                    session_users += 1
        if p.get('type') == 'function_call' and p.get('name', '').split('.')[-1] == 'request_user_input':
            args = json.loads(p['arguments'])
            pending[p['call_id']] = {**base, 'call_id': p['call_id'], 'tool_name': p['name'], 'questions': args['questions'], 'preceding_assistant': previous_assistant}
        if p.get('type') == 'function_call_output' and p.get('call_id') in pending:
            call = pending.pop(p['call_id'])
            call.update(result_line=lineno, result_timestamp_jst=base['timestamp_jst'], raw_result=p['output'])
            calls.append(call)
    for call in pending.values():
        call.update(result_line='', result_timestamp_jst='', raw_result='')
        calls.append(call)
    sessions.append({**source, 'user_occurrences': session_users})

users.sort(key=lambda r: (r['timestamp_utc'], r['session_id'], r['source_line']))
seen = {}
for i, row in enumerate(users, 1):
    row['instruction_id'] = f'U{i:03}'
    fingerprint = hashlib.sha256(row['text'].encode()).hexdigest()
    row['same_text_as'] = seen.get(fingerprint, '')
    seen.setdefault(fingerprint, row['instruction_id'])

calls.sort(key=lambda r: (r['timestamp_utc'], r['session_id'], r['source_line']))
questions, seen_calls = [], set()
for call in calls:
    key = (call['call_id'], call['raw_result'])
    assert key not in seen_calls, 'Duplicate calls require explicit occurrence handling'
    seen_calls.add(key)
    try:
        result = json.loads(call['raw_result'])
    except (json.JSONDecodeError, TypeError):
        result = {}
    answers = result.get('answers', {})
    for q in call['questions']:
        vals = answers.get(q['id'], {}).get('answers', [])
        notes = [v[len('user_note: '):] for v in vals if v.startswith('user_note: ')]
        selections = [v for v in vals if not v.startswith('user_note: ')]
        status = 'answered' if vals else ('aborted' if 'aborted by user' in call['raw_result'] else ('missing_result' if not call['raw_result'] else 'empty_answers'))
        questions.append({**call, 'answer_id': f'Q{len(questions)+1:03}', 'question_id': q['id'], 'header': q.get('header', ''), 'question': q['question'], 'options': q.get('options', []), 'answer_status': status, 'answer_values': vals, 'selected_values': selections, 'user_notes': notes})

dump('instructions.tsv', users, ['instruction_id', 'timestamp_jst', 'session_id', 'source_path', 'source_line', 'ordinal', 'message_id', 'same_text_as', 'text', 'preceding_assistant'])
dump('question_answers.tsv', questions, ['answer_id', 'timestamp_jst', 'result_timestamp_jst', 'session_id', 'source_path', 'source_line', 'result_line', 'call_id', 'question_id', 'header', 'question', 'options', 'answer_status', 'selected_values', 'user_notes', 'answer_values', 'raw_result', 'preceding_assistant'])
dump('sessions.tsv', sessions, ['id', 'cwd', 'title', 'source', 'rollout_path', 'bytes', 'sha256', 'user_occurrences'])
stats = {'sessions': len(sessions), 'user_occurrences': len(users), 'unique_user_texts': len(seen), 'question_calls': len(calls), 'questions': len(questions), 'answer_status_counts': dict(collections.Counter(q['answer_status'] for q in questions)), 'injected_context_occurrences_excluded': len(contexts)}
(OUT / 'extraction_stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(stats, ensure_ascii=False, indent=2))
