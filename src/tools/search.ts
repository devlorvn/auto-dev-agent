import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execa } from 'execa';

// Tool 1: Tìm kiếm nội dung/từ khóa bằng Ripgrep hoặc Grep
export const searchCodeTool = tool(
  async ({ query }) => {
    try {
      // Ưu tiên dùng ripgrep (rg) vì tốc độ vượt trội
      const { stdout } = await execa('rg', ['-n', '--max-count', '30', query], {
        cwd: process.cwd(),
      });
      return stdout || 'No matches found.';
    } catch (error: any) {
      // Fallback sang git grep nếu không có ripgrep
      try {
        const { stdout } = await execa('git', ['grep', '-n', query], {
          cwd: process.cwd(),
        });
        return stdout || 'No matches found.';
      } catch (err: any) {
        return `No matches found or search command failed: ${err.message}`;
      }
    }
  },
  {
    name: 'search_code',
    description: 'Search for a string, function, or symbol in the codebase.',
    schema: z.object({
      query: z.string().describe('The search keyword or code snippet'),
    }),
  }
);

// Tool 2: Tìm file theo tên/extension
export const findFilesTool = tool(
  async ({ pattern }) => {
    try {
      // Tìm file qua git ls-files
      const { stdout } = await execa('git', ['ls-files'], { cwd: process.cwd() });
      const files = stdout.split('\n');
      
      const filtered = files.filter((f) => f.includes(pattern));
      return filtered.length > 0 ? filtered.join('\n') : 'No matching files found.';
    } catch (error: any) {
      return `Error finding files: ${error.message}`;
    }
  },
  {
    name: 'find_files',
    description: 'Find file paths in the local git repository matching a pattern.',
    schema: z.object({
      pattern: z.string().describe('File path segment or extension to filter (e.g. "user.ts" or ".go")'),
    }),
  }
);