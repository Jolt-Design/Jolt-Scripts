import { readFile, writeFile } from 'node:fs/promises'
import ansis from 'ansis'
import { Option } from 'clipanion'
import { fileExists } from '../utils.js'
import JoltCommand from './JoltCommand.js'

export class TemplateCommand extends JoltCommand {
  static paths = [['template']]

  input = Option.String({ required: true })
  output = Option.String({ required: true })
  quiet = Option.Boolean('-q,--quiet', false, { description: 'Suppress command output' })
  ifNotExists = Option.Boolean('-n,--if-not-exists', false, {
    description: 'Only write the output file if it does not already exist',
  })

  async command(): Promise<number | undefined> {
    const { input, output, config, context, quiet, ifNotExists } = this
    const { stdout, stderr } = context

    try {
      if (!quiet) {
        stdout.write(this.getHeader('Template'))
      }

      // Read the input file
      let content: string

      try {
        const buffer = await readFile(input)
        content = buffer.toString('utf-8')
      } catch (error) {
        stderr.write(
          ansis.red(`Error reading input file "${input}": ${error instanceof Error ? error.message : String(error)}\n`),
        )
        return 1
      }

      // Parse arguments in the content
      let parsedContent: string

      try {
        parsedContent = await config.parseArg(content)
      } catch (error) {
        stderr.write(ansis.red(`Error parsing template: ${error instanceof Error ? error.message : String(error)}\n`))
        return 2
      }

      // Check if output file exists when --if-not-exists is set
      if (ifNotExists) {
        const exists = await fileExists(output)

        if (exists) {
          if (!quiet) {
            stdout.write(ansis.yellow('⊘ Output file already exists, skipping write\n'))
            stdout.write(ansis.blue(`  Output: ${output}\n`))
          }

          return 0
        }
      }

      // Write to the output file
      try {
        await writeFile(output, parsedContent, 'utf-8')

        if (!quiet) {
          stdout.write(ansis.green('✓ Template processed successfully\n'))
          stdout.write(ansis.blue(`  Input:  ${input}\n`))
          stdout.write(ansis.blue(`  Output: ${output}\n`))
        }
      } catch (error) {
        stderr.write(
          ansis.red(
            `Error writing output file "${output}": ${error instanceof Error ? error.message : String(error)}\n`,
          ),
        )
        return 3
      }

      return 0
    } catch (error) {
      stderr.write(ansis.red(`Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`))
      return 1
    }
  }
}
