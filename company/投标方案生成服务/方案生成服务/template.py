"""Read and fill existing OOXML text, preserving source drawing/layout objects."""
import json, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'a':'http://schemas.openxmlformats.org/drawingml/2006/main', 'p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
for k,v in NS.items(): ET.register_namespace(k,v)
FIXED = {43,44,45,46}
CLIENT = re.compile(r'模板客户|示例地区B|示例地区A|示例ERP|3C|示例产品A|示例产品B|示例产品C|示例工艺|OEM/ODM')

def manifest(source):
    slides=[]
    with zipfile.ZipFile(source) as z:
        for n in range(1,49):
            root=ET.fromstring(z.read(f'ppt/slides/slide{n}.xml'))
            paras=root.findall('.//a:p',NS)
            slots=[]
            for i,p in enumerate(paras):
                value=''.join(t.text or '' for t in p.findall('.//a:t',NS))
                # Customer-specific short labels also need adaptation. Fixed evidence stays intact.
                if value and ((n not in FIXED and (len(value)>=18 or CLIENT.search(value))) or '模板客户' in value):
                    slots.append({'id':f'{n}:{i}','text':value,'maxChars':100 if value=='模板客户' else max(24,len(value)+8)})
            slides.append({'page':n,'fixed':n in FIXED,'slots':slots})
    return {'version':'v3-48','slides':slides}

def fill(source, datafile, output):
    updates=json.loads(Path(datafile).read_text(encoding='utf-8'))
    spec=manifest(source)
    expected={s['id']:s for page in spec['slides'] for s in page['slots']}
    if set(updates)!=set(expected): raise ValueError('Incomplete template replacements')
    for key,value in updates.items():
        if not isinstance(value,str) or not value.strip() or len(value)>expected[key]['maxChars']:
            raise ValueError('Invalid replacement '+key)
    with zipfile.ZipFile(source) as zin,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as zout:
        for entry in zin.infolist():
            raw=zin.read(entry.filename)
            match=re.fullmatch(r'ppt/slides/slide(\d+)\.xml',entry.filename)
            if match:
                n=int(match.group(1));root=ET.fromstring(raw)
                for i,p in enumerate(root.findall('.//a:p',NS)):
                    key=f'{n}:{i}'
                    if key in updates:
                        texts=p.findall('.//a:t',NS)
                        texts[0].text=updates[key]
                        for text in texts[1:]:text.text=''
                        if expected[key]['text']=='模板客户':
                            # Fit the company identity in the existing single-line cover field.
                            for rpr in p.findall('.//a:rPr',NS):
                                rpr.set('sz',str(min(int(rpr.get('sz','3000')),max(900,int(3000*6/max(6,len(updates[key])))))))
                raw=ET.tostring(root,encoding='utf-8',xml_declaration=True)
            elif entry.filename.startswith('ppt/notesSlides/notesSlide') and entry.filename.endswith('.xml'):
                root=ET.fromstring(raw)
                for t in root.findall('.//a:t',NS):t.text=''
                raw=ET.tostring(root,encoding='utf-8',xml_declaration=True)
            elif entry.filename=='docProps/core.xml':
                root=ET.fromstring(raw)
                for e in root:
                    if e.tag.endswith(('title','subject','description','keywords')):e.text=''
                raw=ET.tostring(root,encoding='utf-8',xml_declaration=True)
            zout.writestr(entry,raw)

if __name__=='__main__':
    if sys.argv[1]=='manifest':
        result=manifest(sys.argv[2]);Path(sys.argv[3]).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
        print(json.dumps({'pages':len(result['slides']),'slots':sum(len(p['slots']) for p in result['slides'])}))
    elif sys.argv[1]=='fill':fill(*sys.argv[2:5])
