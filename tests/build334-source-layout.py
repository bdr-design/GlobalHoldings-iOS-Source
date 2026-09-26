#!/usr/bin/env python3
"""Adversarial tests of source validation, not a simulated iPhone build."""
import importlib.util,json,shutil,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_verifier',ROOT/'tools/verify_current_source.py');V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)
class SourceValidation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        for folder in V.RUNTIME_DIRS:(self.root/folder).mkdir()
        (self.root/'WebApp/app.js').write_text('// test-only source fixture\n')
        (self.root/'iOS/Fixture.swift').write_text('// test-only source fixture\n')
        (self.root/'BUILD').write_text('340\n');(self.root/'VERSION').write_text('3.0.0\n')
        (self.root/'project.yml').write_text('CURRENT_PROJECT_VERSION: "340"\nCFBundleVersion: "340"\nMARKETING_VERSION: "3.0.0"\nCFBundleShortVersionString: "3.0.0"\n')
        files=V.inventory(self.root)
        self.manifest={'version':'3.0.0','build':340,'save_schema':'2.0.0','files':files,'source_tree_sha256':V.tree_digest(files)}
        (self.root/'RUNTIME_SOURCE_MANIFEST.json').write_text(json.dumps(self.manifest));(self.root/'RELEASE_GATE.json').write_text(json.dumps({'approved':False,'blocking_issues':['fixture blocker']}))
    def tearDown(self):self.tmp.cleanup()
    def test_accept_matching_source(self):self.assertTrue(V.verify(self.root)['verified'])
    def test_changed_bytes(self):
        (self.root/'WebApp/app.js').write_text('// altered');self.assertRaisesRegex(ValueError,'byte mismatch',V.verify,self.root)
    def test_missing_file(self):
        (self.root/'WebApp/app.js').unlink();self.assertRaisesRegex(ValueError,'file-set mismatch',V.verify,self.root)
    def test_extra_runtime(self):
        (self.root/'WebApp/overlay.js').write_text('// extra');self.assertRaisesRegex(ValueError,'file-set mismatch',V.verify,self.root)
    def test_runtime_link(self):
        (self.root/'WebApp/link.js').symlink_to('app.js');self.assertRaisesRegex(ValueError,'symlink',V.verify,self.root)
    def test_unsafe_manifest_path(self):
        self.manifest['files']['../outside.js']={};(self.root/'RUNTIME_SOURCE_MANIFEST.json').write_text(json.dumps(self.manifest));self.assertRaisesRegex(ValueError,'Unsafe',V.verify,self.root)
    def test_false_tree_digest(self):
        self.manifest['source_tree_sha256']='0'*64;(self.root/'RUNTIME_SOURCE_MANIFEST.json').write_text(json.dumps(self.manifest));self.assertRaisesRegex(ValueError,'tree digest',V.verify,self.root)
    def test_old_repack_path_rejected(self):
        (self.root/'tools').mkdir();(self.root/'tools/repack_ipa.py').write_text('# obsolete');self.assertRaisesRegex(ValueError,'Retired',V.verify,self.root)
    def test_release_is_not_implied_by_matching_bytes(self):self.assertRaisesRegex(ValueError,'gate is closed',V.verify,self.root,True)
    def test_release_cannot_reuse_other_source_gate(self):
        (self.root/'RELEASE_GATE.json').write_text(json.dumps({'approved':True,'blocking_issues':[],'source_tree_sha256':'0'*64}));self.assertRaisesRegex(ValueError,'gate is closed',V.verify,self.root,True)
if __name__=='__main__':unittest.main(verbosity=2)
