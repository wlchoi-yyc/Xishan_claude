# 把 ref/reference.png（2 欄 x 3 列的參考圖）切成六格，用 EDSR x3 超解像放大，存到 shots/
# 需要：pip install opencv-contrib-python-headless；模型：
#   curl -L -o EDSR_x3.pb https://raw.githubusercontent.com/Saafke/EDSR_Tensorflow/master/models/EDSR_x3.pb
import os
import cv2
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
src = Image.open(os.path.join(HERE, 'ref', 'reference.png')).convert('RGB')
sr = cv2.dnn_superres.DnnSuperResImpl_create()
sr.readModel(os.path.join(HERE, 'EDSR_x3.pb'))
sr.setModel('edsr', 3)
names = ['bamboo', 'pavilion', 'boat', 'climb', 'summit', 'dusk']
os.makedirs(os.path.join(HERE, 'shots'), exist_ok=True)
for i, n in enumerate(names):
    r, c = divmod(i, 2)
    p = src.crop((c * 683 + 2, r * 384 + 2, c * 683 + 681, r * 384 + 382))  # 避開格線
    up = sr.upsample(cv2.cvtColor(np.asarray(p), cv2.COLOR_RGB2BGR))
    im = Image.fromarray(cv2.cvtColor(up, cv2.COLOR_BGR2RGB)).resize((2160, 1215), Image.LANCZOS)
    im.filter(ImageFilter.UnsharpMask(1.2, 40, 2)).save(os.path.join(HERE, 'shots', n + '.jpg'), quality=94)
    print(n)
