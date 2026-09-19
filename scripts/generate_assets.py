"""Generate original artwork and ambient test audio. Requires numpy and Pillow.
All generated assets are released under CC0-1.0. No sampled music or third-party artwork.
"""
from pathlib import Path
import json, math, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / 'web' / 'assets'
ROOT.mkdir(parents=True, exist_ok=True)
(ROOT/'demo').mkdir(exist_ok=True)
W=900
yy,xx=np.mgrid[0:W,0:W]/W
font_path=Path('C:/Windows/Fonts/consola.ttf')
def font(n):
    return ImageFont.truetype(str(font_path),n) if font_path.exists() else ImageFont.load_default()

for index,(base,glow,label) in enumerate([
    ((24,35,31),(171,194,129),'FLOATING / COORDINATES'),
    ((23,28,41),(122,144,209),'NIGHT / TRANSMISSION'),
    ((40,32,29),(216,160,127),'ECHOES / IN THE MIST')
]):
    r=np.sqrt((xx-.52)**2+(yy-.43)**2)
    light=np.exp(-((xx-.43)**2+(yy-.37)**2)*6)*.33
    noise=np.random.default_rng(80+index).normal(0,1.1,(W,W,1))
    arr=np.clip(np.array(base)[None,None,:]+light[:,:,None]*np.array(glow)[None,None,:]+noise,0,255).astype('uint8')
    im=Image.fromarray(arr,'RGB').convert('RGBA')
    layer=Image.new('RGBA',(W,W)); d=ImageDraw.Draw(layer)
    # Fine sculptural contours, each formed by a tilted ring in three dimensions.
    for j in range(115):
        t=j/114
        phi=t*math.pi*2
        points=[]
        for a in np.linspace(0,2*math.pi,300):
            if index==0:
                radius=220+60*math.cos(phi);X=radius*math.cos(a);Y=radius*.57*math.sin(a)+92*math.sin(phi)
                theta=-.58; px=X*math.cos(theta)-Y*math.sin(theta);py=X*math.sin(theta)+Y*math.cos(theta)
            elif index==1:
                radius=200+60*math.sin(phi);X=radius*math.cos(a);Y=radius*math.sin(a)*(.12+.7*t);px=X+40*math.cos(phi);py=Y+70*math.sin(phi)
                px,py=px*.85-py*.25,px*.35+py
            else:
                radius=220+55*math.sin(phi*2);X=radius*math.cos(a);Y=radius*.43*math.sin(a)+90*math.cos(phi)
                px,py=X*.92+Y*.2,-X*.3+Y
            points.append((int(450+px),int(400+py)))
        alpha=int(28+105*(.5+.5*math.cos(phi+1.2)))
        d.line(points,fill=tuple(glow)+(alpha,),width=1)
    im=Image.alpha_composite(im,layer)
    d=ImageDraw.Draw(im)
    muted=tuple(int(c*.68) for c in glow)+(255,)
    d.line((45,45,85,45),fill=muted,width=1);d.line((45,45,45,85),fill=muted,width=1)
    d.line((855,855,815,855),fill=muted,width=1);d.line((855,855,855,815),fill=muted,width=1)
    d.text((52,64),'R E F R A C T',font=font(20),fill=tuple(glow)+(230,))
    d.text((742,66),f'0{index+1} /',font=font(18),fill=muted)
    d.text((53,730),label,font=font(30),fill=tuple(min(255,c+35) for c in glow)+(255,))
    d.text((55,782),'LIGHT STUDIES                 VOL. 01',font=font(16),fill=muted)
    d.line((55,823,845,823),fill=muted,width=1)
    d.text((55,838),'ORIGINAL SOUND EXPERIMENT / 2026',font=font(12),fill=muted)
    im.convert('RGB').save(ROOT/f'cover-{index+1}.png',optimize=True)

icon=Image.new('RGBA',(256,256),(24,31,26,255));d=ImageDraw.Draw(icon)
d.rounded_rectangle((6,6,250,250),radius=52,fill=(30,40,31),outline=(127,148,101),width=2)
d.polygon([(66,191),(126,55),(192,191)],fill=(214,242,149))
d.polygon([(108,155),(139,83),(171,155)],fill=(46,61,38))
d.line((87,191,160,104),fill=(250,255,229),width=5)
icon.save(ROOT/'refract.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
icon.save(ROOT/'refract-icon.png')

sr=44100;seconds=24;t=np.arange(sr*seconds)/sr
notes=[[130.8128,164.8138,195.9977,246.9417],[110,130.8128,164.8138,220],[146.8324,174.6141,220,293.6648]]
for index,chord in enumerate(notes):
    channels=[]
    for channel in range(2):
        signal=np.zeros_like(t)
        for j,f in enumerate(chord):
            modulation=.72+.28*np.sin(2*np.pi*(.045+j*.009)*t+j+channel*.4)
            tone=np.sin(2*np.pi*f*(1+channel*.0008)*t+j*.2)*.055
            tone+=np.sin(2*np.pi*f*2.001*t)*.014
            signal+=tone*modulation
            # Gentle bell accents over the pad; no samples, no abrupt impulses.
            for onset in [2+j*1.3,12+j*1.4]:
                dt=np.maximum(0,t-onset);env=(1-np.exp(-dt*5))*np.exp(-dt*.7)*(t>=onset)
                signal+=np.sin(2*np.pi*f*4*t+channel*.2)*env*.024
        fade=np.minimum(1,t/2.5)*np.minimum(1,(seconds-t)/3)
        channels.append(signal*fade)
    stereo=np.stack(channels,axis=1)
    pcm=np.clip(stereo*32767,-32768,32767).astype('<i2')
    with wave.open(str(ROOT/'demo'/f'{index+1:02}.wav'),'wb') as out:
        out.setnchannels(2);out.setsampwidth(2);out.setframerate(sr);out.writeframes(pcm.tobytes())

catalog=[]
for i,title in enumerate(['漂浮坐标','夜航信号','薄雾回声']):
    catalog.append(dict(id=f'demo-{i+1}',title=title,artist='REFRACT',album='Light Studies · Vol. 01',genre='Ambient',year=2026,number=i+1,duration=seconds,bitrate=1411,sampleRate=sr,format='WAV',favorite=False,edited=False,added=f'2026-09-15T00:00:0{3-i}Z',fileName=f'{i+1:02}.wav',missing=False,cover=f'assets/cover-{i+1}.png',src=f'assets/demo/{i+1:02}.wav'))
(ROOT/'demo'/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
print('Generated 3 original covers, 3 stereo ambient studies, and app icon.')
