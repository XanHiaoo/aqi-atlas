"""Compile every WXML/WXSS entry with the installed WeChat compilers."""
import argparse
import subprocess
import tempfile
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--tools',type=Path,default=Path(r'D:\SoftWare\wechat_devtools_2.02.2608070_win32_x64'))
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
compiler=args.tools/'resources/app.asar.unpacked/node_modules/wcc-exec'
with tempfile.TemporaryDirectory() as directory:
    for suffix,exe in [('wxml','wcc.exe'),('wxss','wcsc.exe')]:
        entries=[str(p.relative_to(root)).replace('\\','/') for p in root.rglob('*.'+suffix)]
        output=Path(directory)/(suffix+'.js')
        subprocess.run([str(compiler/exe),'-o',str(output),*entries],cwd=root,check=True,capture_output=True)
        if not output.exists() or not output.stat().st_size:
            raise RuntimeError('Compiler did not produce output: '+suffix)
        print(f'PASS: WeChat {suffix.upper()} compiler ({len(entries)} files, {output.stat().st_size} bytes).')
