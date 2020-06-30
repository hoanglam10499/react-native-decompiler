import { performance } from 'perf_hooks';
import { PluginConstructor, Plugin } from './plugin';
import Module from './module';
import { NodePath } from '@babel/traverse';

export default class Router<T extends Plugin, TConstructor extends PluginConstructor<T>> {
  static traverseTimeTaken = 0;
  static timeTaken: { [index: string]: number } = {};

  private readonly module: Module;
  private readonly moduleList: Module[];
  private readonly list: T[];
  private readonly listConstructors: TConstructor[];
  private readonly maxPass: number;
  private readonly performance: boolean;

  constructor(list: TConstructor[], module: Module, moduleList: Module[], perfSetting: boolean) {
    this.listConstructors = list;
    this.list = list.map((plugin) => {
      if (perfSetting && Router.timeTaken[plugin.name] == null) {
        Router.timeTaken[plugin.name] = 0;
      }
      return new plugin(module, moduleList);
    });
    this.maxPass = Math.max(...this.list.map(plugin => plugin.pass));
    this.performance = perfSetting;

    this.module = module;
    this.moduleList = moduleList;
  }

  parse = (module: Module) => {
    for (let pass = 1; pass <= this.maxPass; pass += 1) {
      let startTime = performance.now();
      const visitorFunctions: { [index: string]: ((path: NodePath<unknown>) => void)[] } = {};
      this.list.forEach((plugin, i) => {
        if (plugin.pass !== pass) return;
        if (plugin.evaluate && this.performance) {
          startTime = performance.now();
          plugin.evaluate(module.path, this.rerunPlugin);
          Router.timeTaken[this.listConstructors[i].name] += performance.now() - startTime;
        } else if (plugin.evaluate) {
          plugin.evaluate(module.path, this.rerunPlugin);
        } else if (plugin.getVisitor) {
          const visitor: any = plugin.getVisitor(this.rerunPlugin);
          Object.keys(visitor).forEach((key) => {
            if (!visitorFunctions[key]) {
              visitorFunctions[key] = [];
            }
            if (this.performance) {
              visitorFunctions[key].push((path: NodePath<unknown>) => {
                Router.traverseTimeTaken += performance.now() - startTime;
                startTime = performance.now();
                visitor[key](path);
                Router.timeTaken[this.listConstructors[i].name] += performance.now() - startTime;
                startTime = performance.now();
              });
            } else {
              visitorFunctions[key].push(visitor[key]);
            }
          });
        } else {
          throw new Error('Plugin does not have getVisitor nor evaluate');
        }
      });
      const visitor: any = {};
      Object.keys(visitorFunctions).forEach((key) => {
        visitor[key] = this.processVisit(visitorFunctions[key]);
      });
      if (Object.keys(visitor).length > 0) {
        startTime = performance.now();
        module.path.traverse(visitor);
      }
      this.list.forEach((plugin, i) => {
        if (plugin.pass !== pass) return;
        if (plugin.afterPass && this.performance) {
          startTime = performance.now();
          plugin.afterPass(this.rerunPlugin);
          Router.timeTaken[this.listConstructors[i].name] += performance.now() - startTime;
        } else if (plugin.afterPass) {
          plugin.afterPass(this.rerunPlugin);
        }
      });
    }
  };

  processVisit = (plugins: ((path: NodePath<unknown>) => void)[]) => (path: NodePath<unknown>): void => {
    plugins.forEach((fn) => fn(path));
  };

  rerunPlugin = (pluginConstructor: PluginConstructor): void => {
    const plugin = new pluginConstructor(this.module, this.moduleList);
    if (plugin.evaluate) {
      plugin.evaluate(this.module.path, this.rerunPlugin);
    } else if (plugin.getVisitor) {
      this.module.path.traverse(plugin.getVisitor(this.rerunPlugin));
    } else {
      throw new Error('Plugin does not have getVisitor nor evaluate');
    }
  };
}