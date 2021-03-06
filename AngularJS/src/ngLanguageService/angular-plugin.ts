import {IDETypeScriptSession} from "./typings/typescript/util";
import {TypeScriptLanguagePlugin} from "./typings/typescript/ts-plugin";
import {createAngularSessionClass} from "./angular-session";
import {LanguageService} from "./typings/types";

class AngularLanguagePluginFactory implements LanguagePluginFactory {
    create(state: AngularTypeScriptPluginState): {languagePlugin: LanguagePlugin, readyMessage?: any} {

        let angularLanguagePlugin = createPluginClass(state);

        let typeScriptLanguagePlugin: any = new angularLanguagePlugin(state);
        return {
            languagePlugin: typeScriptLanguagePlugin,
            readyMessage: typeScriptLanguagePlugin.readyMessage
        };
    }
}


function createPluginClass(state: AngularTypeScriptPluginState) {
    let fixedPath = state.typescriptPluginPath;

    const TypeScriptLanguagePluginImpl: typeof TypeScriptLanguagePlugin = require(fixedPath + "ts-plugin.js").TypeScriptLanguagePlugin
    const getSession = require(fixedPath + "ts-session-provider.js").getSession
    const createSessionClass = require(fixedPath + "ts-session.js").createSessionClass


    class AngularLanguagePlugin extends TypeScriptLanguagePluginImpl {

        constructor(state: AngularTypeScriptPluginState) {
            super(state);
        }

        protected getSession(ts_impl: typeof ts,
                             loggerImpl: any,
                             commonDefaultOptions: any,
                             pathProcessor: any,
                             mainFile: string,
                             projectEmittedWithAllFiles: any): any {
            let sessionClass: {new(state): IDETypeScriptSession} = createSessionClass(ts_impl, loggerImpl, commonDefaultOptions, pathProcessor, projectEmittedWithAllFiles, mainFile)

            if (ts_impl["ide_processed"]) {
                let requiredObject = require(state.ngServicePath);
                let ng = requiredObject;
                if (typeof requiredObject == "function") {
                    let obj: any = {}
                    obj.typescript = ts_impl;
                    ng = requiredObject(obj);
                }


                extendEx(ts_impl, "createLanguageService", (oldFunction, args) => {
                    let languageService = oldFunction.apply(this, args);
                    let host = args[0];

                    let ngHost = new ng.TypeScriptServiceHost(host, languageService);
                    let ngService: LanguageService = ng.createLanguageService(ngHost);
                    ngHost.setSite(ngService);

                    languageService["ngService"] = ngService
                    languageService["ngHost"] = ngHost;

                    return languageService;

                });
            } else {
                ts_impl["skipNg"] = true;
            }


            let angularSession = createAngularSessionClass(ts_impl, sessionClass);

            return getSession(ts_impl, loggerImpl, commonDefaultOptions, mainFile, projectEmittedWithAllFiles, angularSession);
        }

        overrideSysDefaults(ts_impl: typeof ts, state: TypeScriptPluginState, serverFile: string) {
            const path = require('path');
            let tsPath = path.join(state.serverFolderPath, 'typescript.js');
            try {
                let fullTypescriptVersion = require(tsPath);
                for (let prop in fullTypescriptVersion) {
                    if (fullTypescriptVersion.hasOwnProperty(prop)) {
                        ts_impl[prop] = fullTypescriptVersion[prop];
                    }
                }

                ts_impl["ide_processed"] = true;

                //clean resources
                let name = require.resolve(tsPath);
                delete require.cache[name];
            } catch (err) {
                //do nothing
            }


            super.overrideSysDefaults(ts_impl, state, serverFile);
        }
    }

    return AngularLanguagePlugin;
}

export function extendEx(ObjectToExtend: any, name: string, func: (oldFunction: any, args: any) => any) {

    let oldFunction = ObjectToExtend[name];

    ObjectToExtend[name] = function (this: any) {
        return func.apply(this, [oldFunction, arguments]);
    }
}

export const factory = new AngularLanguagePluginFactory();