#!/usr/bin/env python3
"""Configure the initial admin hash in the host's private Podman environment."""

import getpass
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


ENV_FILE = Path('/etc/resolution-solar/app.env')
IMAGE = 'localhost/resolution-solar:current'
VALIDATE = """
import express from 'express';
import { readConfig } from './server/app.mjs';
import { mailTransport } from './server/mail.mjs';
try {
  const config = readConfig();
  express().set('trust proxy', config.trustProxy);
  mailTransport(process.env, config.origin);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
"""


def configure(password, env_file=ENV_FILE, runner=subprocess.run):
    if env_file.is_symlink() or not env_file.is_file():
        raise RuntimeError(f'Falta el archivo regular {env_file}. Crea primero el entorno del paso 4.')
    original = env_file.read_text(encoding='utf-8')
    command = ['podman', 'run', '--rm', '--network=none', '--read-only',
               '--cap-drop=all', '--security-opt=no-new-privileges']
    hashed = runner(command + ['-i', '--entrypoint=node', IMAGE, 'scripts/hash-password.mjs'],
                    input=password + '\n', text=True, capture_output=True, timeout=60)
    encoded = hashed.stdout.strip()
    if hashed.returncode or not re.fullmatch(r'scrypt:[a-f0-9]{32}:[a-f0-9]{128}', encoded):
        raise RuntimeError('No se pudo generar el hash. Comprueba la imagen y usa entre 14 y 256 caracteres.')
    lines = [line for line in original.splitlines()
             if not re.match(r'^\s*ADMIN_PASSWORD_HASH\s*=', line)]
    updated = '\n'.join(lines) + '\nADMIN_PASSWORD_HASH=' + encoded + '\n'
    candidate_fd, candidate_name = tempfile.mkstemp(prefix='.app.env-check-', dir=env_file.parent)
    candidate = Path(candidate_name)
    try:
        with os.fdopen(candidate_fd, 'w', encoding='utf-8') as output:
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        checked = runner(command + ['--env-file', str(candidate), '--entrypoint=node', IMAGE,
                                    '--input-type=module', '-e', VALIDATE],
                         text=True, capture_output=True, timeout=60)
        if checked.returncode:
            raise RuntimeError('Configuración no válida; app.env se conserva. ' + checked.stderr.strip())
        if env_file.read_text(encoding='utf-8') != original:
            raise RuntimeError('app.env ha cambiado durante la comprobación; vuelve a ejecutar el comando.')
        backup_fd, backup_name = tempfile.mkstemp(prefix='app.env.backup-', dir=env_file.parent)
        with os.fdopen(backup_fd, 'w', encoding='utf-8') as backup:
            backup.write(original)
            backup.flush()
            os.fsync(backup.fileno())
        candidate.replace(env_file)
        return Path(backup_name)
    finally:
        candidate.unlink(missing_ok=True)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Ejecuta este script con sudo en el servidor.')
    if not sys.stdin.isatty():
        raise RuntimeError('Ejecuta el comando en un terminal interactivo para ocultar la contraseña.')
    password = getpass.getpass('Contraseña inicial del panel (14–256 caracteres): ')
    repeated = getpass.getpass('Repite la contraseña: ')
    if password != repeated:
        raise RuntimeError('Las contraseñas no coinciden; no se ha modificado nada.')
    configure(password)
    print('Configuración validada y hash guardado. Permisos 600; copia anterior en /etc/resolution-solar/.')
    print('La contraseña no se ha mostrado ni guardado en texto. Ya puedes arrancar el servicio.')
    print('Este comando configura el acceso inicial; no restablece una cuenta que ya exista en SQLite.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
