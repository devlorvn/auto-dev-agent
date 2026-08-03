#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { agentApp } from './graph';

dotenv.config();

const program = new Command();

program
  .name('agent')
  .description('Universal AI Coding Agent for local codebase')
  .version('1.0.0');

program
  .command('run')
  .description('Run agent on a specific GitHub issue')
  .requiredOption('-i, --issue <number>', 'GitHub Issue ID', parseInt)
  .action(async (options) => {
    console.log(chalk.bold.cyan(`🚀 Starting Auto-Dev Agent for Issue #${options.issue}...`));
    
    try {
      await agentApp.invoke({
        issueId: options.issue,
        issueTitle: '',
        issueBody: '',
        testPassed: false,
        retryCount: 0,
      });
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

program.parse(process.argv);