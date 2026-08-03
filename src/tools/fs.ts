import fs from 'fs/promises';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// Tool 1: Đọc nội dung file
export const readFileTool = tool(
  async ({ filePath }) => {
    try {
      const absolutePath = path.resolve(process.cwd(), filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      return content;
    } catch (error: any) {
      return `Error reading file ${filePath}: ${error.message}`;
    }
  },
  {
    name: 'read_file',
    description: 'Read the complete text content of a local file by path.',
    schema: z.object({
      filePath: z.string().describe('Relative or absolute file path to read'),
    }),
  }
);

// Tool 2: Ghi đè hoặc Tạo file mới
export const writeFileTool = tool(
  async ({ filePath, content }) => {
    try {
      const absolutePath = path.resolve(process.cwd(), filePath);
      // Tự động tạo thư mục nếu chưa tồn tại
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      return `Successfully wrote file: ${filePath}`;
    } catch (error: any) {
      return `Error writing file ${filePath}: ${error.message}`;
    }
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file with whole new text content.',
    schema: z.object({
      filePath: z.string().describe('File path to write'),
      content: z.string().describe('The content to write into the file'),
    }),
  }
);

// Tool 3: Sửa file theo dạng thay thế chuỗi (Search & Replace)
export const editFileTool = tool(
  async ({ filePath, oldStr, newStr }) => {
    try {
      const absolutePath = path.resolve(process.cwd(), filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');

      if (!content.includes(oldStr)) {
        return `Error: String "${oldStr}" not found in file ${filePath}`;
      }

      const updatedContent = content.replace(oldStr, newStr);
      await fs.writeFile(absolutePath, updatedContent, 'utf-8');
      return `Successfully replaced text in ${filePath}`;
    } catch (error: any) {
      return `Error editing file ${filePath}: ${error.message}`;
    }
  },
  {
    name: 'edit_file',
    description: 'Replace an existing block/string in a file with a new string.',
    schema: z.object({
      filePath: z.string().describe('File path to edit'),
      oldStr: z.string().describe('Exact block of text to replace'),
      newStr: z.string().describe('New block of text'),
    }),
  }
);