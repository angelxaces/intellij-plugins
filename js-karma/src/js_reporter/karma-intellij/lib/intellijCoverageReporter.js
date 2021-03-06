var cli = require('./intellijCli.js')
  , intellijUtil = require('./intellijUtil.js')
  , fs = require('fs')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter
  , coveragePreprocessorName = 'coverage';

/**
 * Configures coverage if 'Run with coverage' action performed
 * @param {Object} config
 */
function configureCoverage(config) {
  var karmaCoverageReporterName = 'coverage';
  var reporters = config.reporters || [];
  if (cli.isWithCoverage()) {
    // Ensure 'coverage' reporter is specified, otherwise coverage preprocessor won't work:
    //   https://github.com/karma-runner/karma-coverage/blob/v0.5.3/lib/preprocessor.js#L54
    if (!isWebpackUsed(config) && reporters.indexOf(karmaCoverageReporterName) < 0) {
      reporters.push(karmaCoverageReporterName);
      console.log('IntelliJ integration enabled coverage by adding \'' + karmaCoverageReporterName + '\' reporter');
      // 'coverage' reporter uses settings from 'config.coverageReporter'. If no settings set,
      //    by default coverage report files will be stored inside project.
      if (!config.hasOwnProperty('coverageReporter')) {
        // 'coverage' reporter and 'config.coverageReporter' not configured =>
        //    let's prevent generating default coverage report files in "coverage/" directory, since
        //    it wasn't asked explicitly and the generated lcovonly file most likely is of no used
        config.coverageReporter = {
          type : 'lcovonly',
          dir : path.join(cli.getCoverageTempDirPath(), 'unused'),
          reporters: []
        };
      }
    }
    reporters.push(IntellijCoverageReporter.reporterName);
  }
  else if (canCoverageBeDisabledSafely(config.coverageReporter)) {
    if (reporters.indexOf(karmaCoverageReporterName) >= 0) {
      reporters = intellijUtil.removeAll(reporters, karmaCoverageReporterName);
      console.log('IntelliJ integration disabled coverage for faster run and debug capabilities');
    }
  }
  config.reporters = reporters;
}

/**
 * @param {Object} coverageReporter
 * @returns {boolean} true if tests can be successfully run without coverage reporter and preprocessor
 */
function canCoverageBeDisabledSafely(coverageReporter) {
  return coverageReporter == null || (
      !Object.prototype.hasOwnProperty.call(coverageReporter, 'instrumenter') &&
      !Object.prototype.hasOwnProperty.call(coverageReporter, 'instrumenters')
    );
}

function findLcovInfoFile(coverageDir, callback) {
  var first = true;
  fs.readdir(coverageDir, function(err, files) {
    if (!err && files) {
      files.forEach(function(fileName) {
        var browserDir = path.join(coverageDir, fileName);
        fs.stat(browserDir, function(err, stats) {
          if (!err && stats && stats.isDirectory()) {
            var lcovFilePath = path.join(browserDir, "lcov.info");
            fs.stat(lcovFilePath, function(err, stats) {
              if (!err && stats && stats.isFile()) {
                if (first) {
                  first = false;
                  callback(lcovFilePath);
                }
              }
            });
          }
        });
      });
    }
  });
}

/**
 * If webpack is used, coverage is configured in a different way:
 *  - no explicit 'coverage' reporter needed
 *  - no explicit 'coverage' preprocessor needed
 *
 * @param config karma config
 * @returns {boolean} true if webpack preprocessor is configured
 */
function isWebpackUsed(config) {
  return intellijUtil.isPreprocessorSpecified(config.preprocessors, 'webpack');
}

function createKarmaCoverageReporter(injector, emitter, config) {
  try {
    var karmaCoverageReporterName = 'reporter:coverage';
    var locals = {
      emitter: ['value', emitter],
      config:  ['value', config]
    };
    var childInjector = injector.createChild([locals], [karmaCoverageReporterName]);
    return childInjector.get(karmaCoverageReporterName);
  }
  catch (ex) {
    return null;
  }
}

function IntellijCoverageReporter(injector, config) {
  var that = this;
  var emitter = new EventEmitter();
  var newConfig = {
    coverageReporter : {
      type : 'lcovonly',
      dir : cli.getCoverageTempDirPath()
    },
    basePath : config.basePath
  };

  var karmaCoverageReporter = createKarmaCoverageReporter(injector, emitter, newConfig);
  if (karmaCoverageReporter != null) {
    that = karmaCoverageReporter;
    init.call(karmaCoverageReporter, emitter, newConfig);
  }
  else {
    console.warn("IDE coverage reporter is disabled");
    this.adapters = [];
  }
  // Missing coverage preprocessor is a common mistake that results in empty coverage reports.
  // Reporting such a mistake before actually running tests with coverage improves user experience.
  var coveragePreprocessorSpecifiedInConfig = intellijUtil.isPreprocessorSpecified(config.preprocessors, coveragePreprocessorName) ||
                                              isWebpackUsed(config);
  IntellijCoverageReporter.reportCoverageStartupStatus(coveragePreprocessorSpecifiedInConfig, karmaCoverageReporter != null);
  return that;
}

/**
 * Informs IDE about code coverage configuration correctness.
 * @param {boolean} coveragePreprocessorSpecifiedInConfig
 * @param {boolean} coverageReporterFound
 */
IntellijCoverageReporter.reportCoverageStartupStatus = function (coveragePreprocessorSpecifiedInConfig,
                                                                 coverageReporterFound) {
  intellijUtil.sendIntellijEvent('coverageStartupStatus', {
    coveragePreprocessorSpecifiedInConfig : coveragePreprocessorSpecifiedInConfig,
    coverageReporterFound : coverageReporterFound
  });
};

// invoked in context of original karmaCoverageReporter
function init(emitter, rootConfig) {
  var currentBrowser = null;

  var superOnRunStart = this.onRunStart.bind(this);
  this.onRunStart = function(browsers) {
    currentBrowser = findBestBrowser(browsers);
    var browserArray = [];
    if (currentBrowser) {
      browserArray = [currentBrowser];
    }
    superOnRunStart(browserArray);
  };

  if (typeof this.onBrowserStart === 'function') {
    var superOnBrowserStart = this.onBrowserStart.bind(this);
    this.onBrowserStart = function(browser) {
      if (browser === currentBrowser) {
        superOnBrowserStart.apply(this, arguments);
      }
    };
  }

  var superOnSpecComplete = this.onSpecComplete.bind(this);
  this.onSpecComplete = function(browser/*, result*/) {
    if (browser === currentBrowser) {
      superOnSpecComplete.apply(this, arguments);
    }
  };

  var superOnBrowserComplete = this.onBrowserComplete.bind(this);
  this.onBrowserComplete = function(browser/*, result*/) {
    if (browser === currentBrowser && currentBrowser) {
      currentBrowser.argumentsForOnBrowserComplete = arguments;
    }
  };

  var superOnRunComplete = this.onRunComplete.bind(this);
  this.onRunComplete = function (browsers/*, results*/) {
    var found = currentBrowser && containsBrowser(browsers, currentBrowser);
    if (found) {
      // no need in mering 'onBrowserComplete' anymore
      // get rid of 'argumentsForOnBrowserComplete'
      if (currentBrowser.argumentsForOnBrowserComplete) {
        superOnBrowserComplete.apply(this, currentBrowser.argumentsForOnBrowserComplete);
      }
      superOnRunComplete([currentBrowser]);

      var done = function() {
        findLcovInfoFile(rootConfig.coverageReporter.dir, function(lcovFilePath) {
          intellijUtil.sendIntellijEvent('coverageFinished', lcovFilePath);
        });
      };

      // we need a better way of setting custom 'fileWritingFinished'
      if (typeof this.onExit === 'function') {
        this.onExit(done);
      }
      else {
        // to keep backward compatibility
        emitter.emit('exit', done);
      }
    }
  };
}

function findBestBrowser(browsers) {
  if (browsers.length <= 1) {
    return getAnyBrowser(browsers);
  }
  var browserNamesInPreferredOrder = ['Chrome ', 'Firefox ', 'Safari ', 'Opera '];
  var len = browserNamesInPreferredOrder.length;
  for (var i = 0; i < len; i++) {
    var browser = findBrowserByName(browsers, browserNamesInPreferredOrder[i]);
    if (browser) {
      return browser;
    }
  }
  return getAnyBrowser(browsers);
}

function getAnyBrowser(browsers) {
  var result = null;
  browsers.forEach(function (browser) {
    if (result == null) {
      result = browser;
    }
  });
  return result;
}

function containsBrowser(browsers, targetBrowser) {
  var result = false;
  browsers.forEach(function (browser) {
    if (browser === targetBrowser) {
      result = true;
    }
  });
  return result;
}

function findBrowserByName(browsers, browserNamePrefix) {
  var result = null;
  browsers.forEach(function (browser) {
    var browserName = browser.name;
    if (result == null && intellijUtil.isString(browserName) && browserName.indexOf(browserNamePrefix) === 0) {
      result = browser;
    }
  });
  return result;
}

IntellijCoverageReporter.$inject = ['injector', 'config'];
IntellijCoverageReporter.reporterName = 'intellijCoverage_33e284dac2b015a9da50d767dc3fa58a';
IntellijCoverageReporter.configureCoverage = configureCoverage;

module.exports = IntellijCoverageReporter;
