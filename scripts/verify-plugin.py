"""独立校验发布文件摘要、ZIP CRC、入口、native 库及生产清单，构建和发布前各执行一次。"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

# 宿主按平台固定加载的 native 库名（见 otools 的 platform_lib_name）
PLATFORM_LIB_NAMES = ('Windows.dll', 'Linux.so', 'macOS.dylib')


def verify(directory, expected_version=None, expected_packid=None):
    directory = Path(directory)
    manifest = json.loads((directory / 'plugin.json').read_text(encoding='utf-8'))
    packid, version = manifest['packid'], manifest['version']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', packid) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('发布清单标识或版本无效')
    if expected_version and version != expected_version:
        raise ValueError('构建与发布版本不一致')
    if expected_packid and packid != expected_packid:
        raise ValueError('构建与发布插件标识不一致')
    filename = f'{packid}-{version}.oplg'
    expected = {filename, 'plugin.json', 'logo.svg'}
    checksums = {}
    for line in (directory / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
        digest, name = line.split('  ', 1)
        if not re.fullmatch(r'[0-9a-f]{64}', digest) or name not in expected or name in checksums:
            raise ValueError('摘要清单无效')
        checksums[name] = digest
    if set(checksums) != expected or {file.name for file in directory.glob('*.oplg')} != {filename}:
        raise ValueError('发布文件不完整或混入其他版本')
    for name, digest in checksums.items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != digest:
            raise ValueError('发布文件摘要不匹配：' + name)
    if manifest.get('devUrl') or manifest.get('quickDev'):
        raise ValueError('正式包不能启用开发模式')
    with zipfile.ZipFile(directory / filename) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('ZIP 含重复文件')
        for name in names:
            if '\\' in name or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
                raise ValueError('ZIP 文件路径无效')
        if archive.testzip() is not None:
            raise ValueError('ZIP CRC 校验失败')
        if manifest['entry'] not in names or 'logo.svg' not in names:
            raise ValueError('ZIP 缺少入口或图标')
        # native 插件：lib/ 下必须有符合宿主约定的非空平台库，
        # 否则会出现「装上但 native 功能全废」的包。
        if (manifest.get('native') or {}).get('enabled'):
            libs = [
                name for name in names
                if name.startswith('lib/') and name.endswith(('.dll', '.so', '.dylib'))
            ]
            if not libs:
                raise ValueError('native 插件缺少 lib/ 下的平台动态库')
            unexpected = [
                PurePosixPath(name).name for name in libs
                if PurePosixPath(name).name not in PLATFORM_LIB_NAMES
            ]
            if unexpected:
                raise ValueError('native 库名不符合宿主约定：' + ', '.join(unexpected))
            if all(archive.getinfo(name).file_size == 0 for name in libs):
                raise ValueError('native 库为空文件')
        if json.loads(archive.read('plugin.json')) != manifest:
            raise ValueError('包内清单与发布清单不一致')
        if archive.read('logo.svg') != (directory / 'logo.svg').read_bytes():
            raise ValueError('包内与独立发布的图标不一致')
    print(f'插件包验证通过：{packid} v{version}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    parser.add_argument('--version')
    parser.add_argument('--packid')
    args = parser.parse_args()
    try:
        verify(args.directory, args.version, args.packid)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print('插件包验证失败：' + str(error), file=sys.stderr)
        sys.exit(1)
