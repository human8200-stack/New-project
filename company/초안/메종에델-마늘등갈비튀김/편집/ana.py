import sys, subprocess, numpy as np
f = sys.argv[1]
raw = subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ar','48000','-f','f32le','-'],capture_output=True).stdout
x = np.frombuffer(raw, np.float32).astype(float)
sr = 48000; w = 4800
lim = np.abs(x).max()
print('max', round(20*np.log10(lim),2))
for i in range(len(x)//w):
    s = x[i*w:(i+1)*w]
    rms = 20*np.log10(np.sqrt((s**2).mean())+1e-9)
    X = np.abs(np.fft.rfft(s*np.hanning(w)))**2; fr = np.fft.rfftfreq(w,1/sr)
    hf = 10*np.log10(X[fr>6000].sum()/(X.sum()+1e-12)+1e-12)
    flat = np.exp(np.mean(np.log(X[(fr>2000)&(fr<12000)]+1e-12)))/(np.mean(X[(fr>2000)&(fr<12000)])+1e-12)
    near = int((np.abs(s) > lim*0.97).sum())
    d = np.abs(np.diff(s)); click = d.max()/(np.median(d)+1e-9)
    print(f'{i/10:5.1f} rms{rms:6.1f} hf{hf:6.1f} flat{flat:5.2f} lim{near:4d} clk{click:6.0f}')
