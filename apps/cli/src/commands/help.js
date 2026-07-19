'use strict';

const {
  print,
} = require('../command-context');

function printHelp() {
  print('JS Eyes CLI');
  print('');
  print('Commands:');
  print('  js-eyes server start [--foreground] [--host localhost] [--port 18080]');
  print('  js-eyes server stop');
  print('  js-eyes server token [show|init|rotate] [--reveal]');
  print('  js-eyes status');
  print('  js-eyes doctor');
  print('  js-eyes audit tail [--lines 100] [--since <iso>]');
  print('  js-eyes consent list|approve <id>|deny <id>');
  print('  js-eyes egress list|approve <id>|allow <domain>|clear');
  print('  js-eyes security show|enforce <off|soft|strict>|reload');
  print('  js-eyes config get [key]');
  print('  js-eyes config set <key> <value>');
  print('  js-eyes skills list [--registry https://js-eyes.com/skills.json]');
  print('  js-eyes skills install <skillId> [--force] [--plan] [--allow-postinstall]');
  print('  js-eyes skills update <skillId|--all> [--dry-run] [--allow-postinstall]');
  print('  js-eyes skills approve <skillId>');
  print('  js-eyes skills verify [skillId]');
  print('  js-eyes skills enable <skillId>');
  print('  js-eyes skills disable <skillId>');
  print('  js-eyes skills link <path>        # add an external skill directory (zero-restart)');
  print('  js-eyes skills unlink <path>      # remove an external skill directory');
  print('  js-eyes skills reload             # ask the running plugin to reload skills');
  print('  js-eyes skill run <skillId> <command> [args...]');
  print('  js-eyes openclaw plugin-path');
  print('  js-eyes extension download <chrome|firefox> [--output /tmp/file]');
  print('  js-eyes native-host install|uninstall|status [--browser all|chrome|firefox|chromium|edge|brave]');
}

module.exports = { printHelp };
