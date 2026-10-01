from pathlib import Path
import sys
import re
import pymupdf
base = Path(sys.argv[1])
paths = [base / 'vocab-template.pdf', Path('tmp/pdfs/vocab-500.pdf'), Path('tmp/pdfs/vocab-long.pdf')]
for path in paths:
    doc = pymupdf.open(path)
    for page in doc:
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    x0, y0, x1, y1 = span['bbox']
                    assert 35 <= x0 and x1 <= 560, (path, page.number, span)
                    assert 20 <= y0 and y1 <= 829, (path, page.number, span)
        assert f'{page.number + 1} / {len(doc)}' in page.get_text()
    text = ''.join(page.get_text() for page in doc)
    assert '\ufffd' not in text
    if '500' in path.name:
        for i in range(1, 501):
            assert re.search(rf'word-{i}\b', text), (path, i)
    elif 'long' in path.name:
        assert len(doc) > 1
        spans = [span for page in doc for block in page.get_text('dict')['blocks'] for line in block.get('lines', []) for span in line['spans'] if 140 <= span['bbox'][1] <= 788]
        definitions = re.sub(r'\s+', '', ''.join(s['text'] for s in spans if s['bbox'][0] >= 260))
        sentences = re.sub(r'\s+', '', ''.join(s['text'] for s in spans if 75 <= s['bbox'][0] < 260 and s['size'] < 11))
        assert definitions.count('连续的中文释义可以完整换行，而不会丢失内容。') == 100
        assert sentences.count('Alongoriginalsentencemustcontinueacrosspageswithoutclippinganytext.') == 100
    else:
        for expected in ['我的单词表', '可持续性', '自测', '中文释义', '单词复习', 'café', 'θ ð ŋ ɜː ʃ ʒ']:
            assert expected in text, expected
    print(path.name, len(doc), 'pages: text preservation and bounds passed')
