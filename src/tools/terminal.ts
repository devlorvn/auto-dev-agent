import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execa } from 'execa';

export const runCommandTool = tool(
  async ({ command }) => {
    try {
      // Tách lệnh và argument
      const [cmd, ...args] = command.trim().split(/\s+/);

      if (typeof cmd !== 'string') {
        return 'Invalid command.';
      }
      
      const { stdout, stderr } = await execa(cmd, args, {
        cwd: process.cwd(),
        reject: false, // Không throw exception nếu command trả về exit status non-zero (vd: test fail)
      });

      let output = stdout;
      if (stderr) {
        output += `\n[STDERR]:\n${stderr}`;
      }
      return output.trim() || 'Command executed with no output.';
    } catch (error: any) {
      return `Execution error: ${error.message}`;
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the local workspace directory (e.g. run test suite, build commands).',
    schema: z.object({
      command: z.string().describe('The command to execute (e.g. "npm test", "pytest", "go test ./...")'),
    }),
  }
);