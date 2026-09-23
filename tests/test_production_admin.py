import importlib.util
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


source = Path(__file__).resolve().parents[1] / 'scripts/configure-production-admin.py'
spec = importlib.util.spec_from_file_location('production_admin', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
HASH = 'scrypt:' + 'a' * 32 + ':' + 'b' * 128


class ProductionAdminTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env = Path(self.directory.name) / 'app.env'
        self.original = 'MAIL_TO=owner@example.test\nADMIN_PASSWORD_HASH=invalid\nSMTP_PASSWORD=preserve-this\n'
        self.env.write_text(self.original)

    def runner(self, arguments, **options):
        self.assertIn('--network=none', arguments)
        self.assertNotIn('test-password-private', arguments)
        if 'scripts/hash-password.mjs' in arguments:
            self.assertEqual(options['input'], 'test-password-private\n')
            return subprocess.CompletedProcess(arguments, 0, HASH + '\n', '')
        candidate = Path(arguments[arguments.index('--env-file') + 1])
        self.assertIn('ADMIN_PASSWORD_HASH=' + HASH, candidate.read_text())
        self.assertEqual(stat.S_IMODE(candidate.stat().st_mode), 0o600)
        return subprocess.CompletedProcess(arguments, 0, '', '')

    def test_saves_validated_hash_preserves_other_settings_and_private_backup(self):
        backup = module.configure('test-password-private', self.env, self.runner)
        self.assertEqual(backup.read_text(), self.original)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.env.stat().st_mode), 0o600)
        self.assertIn('SMTP_PASSWORD=preserve-this', self.env.read_text())
        self.assertEqual(self.env.read_text().count('ADMIN_PASSWORD_HASH='), 1)
        self.assertNotIn('test-password-private', self.env.read_text())
        self.assertNotIn('test-password-private', backup.read_text())

    def test_failed_validation_leaves_original_file_untouched(self):
        def fail(arguments, **options):
            result = self.runner(arguments, **options)
            if '--env-file' in arguments:
                return subprocess.CompletedProcess(arguments, 1, '', 'Invalid configuration')
            return result
        with self.assertRaisesRegex(RuntimeError, 'Configuración no válida'):
            module.configure('test-password-private', self.env, fail)
        self.assertEqual(self.env.read_text(), self.original)
        self.assertEqual(list(self.env.parent.iterdir()), [self.env])

    def test_rejects_broken_hash_before_touching_configuration(self):
        def fail(arguments, **options):
            return subprocess.CompletedProcess(arguments, 0, 'not-a-valid-hash', '')
        with self.assertRaisesRegex(RuntimeError, 'No se pudo generar'):
            module.configure('test-password-private', self.env, fail)
        self.assertEqual(self.env.read_text(), self.original)

    def test_does_not_overwrite_a_concurrent_edit(self):
        def edit(arguments, **options):
            result = self.runner(arguments, **options)
            if '--env-file' in arguments:
                self.env.write_text(self.original + 'EXTRA=keep\n')
            return result
        with self.assertRaisesRegex(RuntimeError, 'ha cambiado'):
            module.configure('test-password-private', self.env, edit)
        self.assertIn('EXTRA=keep', self.env.read_text())


if __name__ == '__main__':
    unittest.main()
