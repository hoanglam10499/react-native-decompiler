/**
  React Native Decompiler
  Copyright (C) 2020 Richard Fu and contributors

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as t from '@babel/types';
import generator from '@babel/generator';
import { NodePath, Visitor } from '@babel/traverse';
import debug from 'debug';
import Module from './module';
import CmdArgs from './interfaces/cmdArgs';

export interface PluginConstructor<T extends Plugin = Plugin> {
  new(cmdArgs: CmdArgs, module: Module, moduleList: Module[]): T;
}

export abstract class Plugin {
  /** Which pass this plugin should run. Starts at pass #1. Set to 0 or less on construction to skip.  */
  abstract readonly pass: number;
  /** The name of the plugin */
  readonly name?: string;
  protected readonly cmdArgs: CmdArgs;
  protected readonly module: Module;
  protected readonly moduleList: Module[];

  constructor(cmdArgs: CmdArgs, module: Module, moduleList: Module[]) {
    this.cmdArgs = cmdArgs;
    this.module = module;
    this.moduleList = moduleList;
  }

  /**
   * Get a visitor that contains the plugin parsing. Use this for simplier plugins.
   * Do not use path.skip() or path.stop() if your plugin uses this method.
   */
  getVisitor?(rerunPlugin: (pluginConstructor: PluginConstructor) => void): Visitor;

  /** Do a full evaluation. Use this for advanced plugins, or for plugins that don't do traversals. */
  evaluate?(block: NodePath<t.FunctionExpression>, rerunPlugin: (pluginConstructor: PluginConstructor) => void): void;

  /** Runs after the pass completes. Note that the AST of the module may have changed if you stored stuff in getVisitor or evaluate. */
  afterPass?(rerunPlugin: (pluginConstructor: PluginConstructor) => void): void;

  private getDebugName() {
    return `react-native-decompiler:${this.name ?? 'plugin'}-${this.module.moduleId}`;
  }

  protected debugLog(val: unknown): void {
    debug(this.getDebugName())(val);
  }

  /**
   * [DEBUG] Returns the code of the path
   * @param path The path to generate code from
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected debugPathToCode(path: NodePath<any>): string {
    if (!debug(this.getDebugName()).enabled) return '';
    return generator({
      ...this.module.originalFile.program,
      type: 'Program',
      body: [t.isStatement(path.node) ? path.node : t.expressionStatement(path.node)],
    }).code;
  }

  protected navigateToModuleBody(path: NodePath<t.FunctionExpression>): NodePath<t.BlockStatement> {
    return path.get('body');
  }

  protected hasTag(tag: string): boolean {
    return this.module.tags.includes(tag);
  }

  protected addTag(tag: string): void {
    this.module.tags.push(tag);
  }

  protected variableIsForDependency(path: NodePath<t.VariableDeclarator>, dep: string | string[]): boolean {
    const depArray = dep instanceof Array ? dep : [dep];

    const callExpression = path.get('init');
    if (!callExpression.isCallExpression()) return false;

    const requireValue = t.isStringLiteral(callExpression.node.arguments[0]) ? callExpression.node.arguments[0].value : null;
    const dependencyName = this.getModuleDependency(callExpression)?.moduleName ?? requireValue ?? '';

    return depArray.includes(dependencyName);
  }

  protected getModuleDependency(path: NodePath<t.CallExpression>): Module | null {
    if (!t.isIdentifier(path.node.callee)) return null;
    if (!t.isNumericLiteral(path.node.arguments[0]) && !t.isMemberExpression(path.node.arguments[0]) && !t.isStringLiteral(path.node.arguments[0])) return null;
    if (path.scope.getBindingIdentifier(path.node.callee.name)?.start !== this.module.requireParam?.start) return null;

    if (t.isMemberExpression(path.node.arguments[0]) && t.isNumericLiteral(path.node.arguments[0].property)) {
      return this.moduleList[this.module.dependencies[path.node.arguments[0].property.value]] ?? null;
    }

    if (t.isStringLiteral(path.node.arguments[0])) {
      const nonNpmRegexTest = /\.\/([0-9]+)/.exec(path.node.arguments[0].value);
      if (nonNpmRegexTest != null) {
        return this.moduleList[this.module.dependencies[+nonNpmRegexTest[1]]];
      }
      return this.moduleList.find((mod) => t.isStringLiteral(path.node.arguments[0]) && mod?.moduleName === path.node.arguments[0].value) ?? null;
    }

    if (t.isNumericLiteral(path.node.arguments[0])) {
      return this.moduleList[this.module.dependencies[path.node.arguments[0].value]] ?? null;
    }

    return null;
  }
}
