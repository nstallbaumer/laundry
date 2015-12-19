'use strict';

var readline = require('readline'); // https://nodejs.org/api/readline.html
var wrap = require('word-wrap'); // https://www.npmjs.com/package/word-wrap
var chalk = require('chalk'); // https://github.com/sindresorhus/chalk
var child_process = require('child_process'); // https://nodejs.org/api/child_process.html

// Singleton Laundry class, generally the entry point to the whole thing.
function Laundry() {}

// Options to pass to the word wrap method.
Laundry._wrapOpts = {
    width: 70
};

// Create a new job.
Laundry.create = function(jobName, callback) {
    jobName = jobName || '';
    // Convert name to confirm to S3 bucket naming best practices
    jobName = jobName.toLowerCase(); // No capital letters (A-Z)
    jobName = jobName.replace('.', '-'); // No periods (.)
    jobName = jobName.replace('_', '-'); // No underscores (_)
    jobName = jobName.replace(/(^-|-$)/g, ''); // - cannot appear at the beginning nor end of the bucket name
    jobName = jobName.substr(0, 32); // The bucket name must be less than or equal to 32 characters long
    if (!jobName || jobName === 'all') {
        console.log("Specify a name for the job with " + chalk.bold("laundry create [job]") + ".\n");
        Laundry.list(callback);
        return;
    }

    // input, output, or null -- used to control the completion behavior
    var mode = null;

    async.waterfall([

        // Set up the console.
        function(callback) {
            var rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                completer: function(line) {
                    return Laundry._tabComplete(mode, line);
                }
            });
            callback(null, rl);
        },

        // Get the job
        function(rl, callback) {
            var job = laundryConfig.jobs.filter(function(job) {
                return job && job.name.toLowerCase() === jobName.toLowerCase();
            })[0];
            if (job) {
                rl.write(wrap(util.format("There's already a job called " + chalk.green.bold("%s") + ", so we'll edit it.\n", jobName), Laundry._wrapOpts));
                callback(null, rl, job);
            } else {
                rl.write(wrap(util.format("Great, let's create a new job called " + chalk.green.bold("%s") + ".\n", jobName), Laundry._wrapOpts));
                job = new Job({
                    name: jobName
                });
                callback(null, rl, job);
            }
        },

        // Ask for the input washer.
        function(rl, job, callback) {
            mode = 'input';
            Laundry._askForWasher(rl, job, mode, function(err) {
                callback(err, rl, job);
            });
        },

        // Configure the input washer.
        function(rl, job, callback) {
            mode = null;
            Laundry._inheritSettings(job.input, 'input');
            Laundry._configureWasher(rl, job, 'input', function(err) {
                callback(err, rl, job);
            });
        },

        // Request the output washer.
        function(rl, job, callback) {
            mode = 'output';
            Laundry._askForWasher(rl, job, mode, function(err) {
                callback(err, rl, job);
            });
        },

        // Configure the output washer.
        function(rl, job, callback) {
            mode = null;
            Laundry._inheritSettings(job.output, 'output');
            Laundry._configureWasher(rl, job, 'output', function(err) {
                callback(err, rl, job);
            });
        },

        // Configure scheduling.
        function(rl, job, callback) {
            mode = null;
            Laundry._scheduleJob(rl, job, function(err) {
                callback(err, rl, job);
            });
        }

    ], function(err, rl, job) {
        if (err) {
            callback(err);
        } else if (job) {
            if (laundryConfig.jobs.indexOf(job) === -1) {
                laundryConfig.jobs.push(job);
            }
            Storage.saveConfig(function(err) {
                if (err) {
                    callback(err);
                    return;
                }
                rl.write("\n" + chalk.green(wrap(util.format("Cool, the job " + chalk.bold("%s") + " is all set up!\n", job.name), Laundry._wrapOpts)));
                rl.close();
                callback();
            });
        }
    });
};

// Tab completion function to complete washer names in the console. Weird.
// https://nodejs.org/api/readline.html#readline_readline_createinterface_options
Laundry._tabComplete = function(mode, line) {
    line = line.toLowerCase();
    if (!line) {
        return [
            [], line
        ];
    }

    var validWashers = [];
    if (mode) {
        for (var i in allWashers) {
            var w = new allWashers[i]();
            if (w[mode] && w.name) {
                validWashers.push(w);
            }
        }
    }

    var completions = validWashers.map(function(washer) {
        return washer.name;
    });

    completions.sort();
    completions = completions.filter(function(completion) {
        return completion.toLowerCase().indexOf(line) === 0;
    });
    return [completions, line];
};

// Prompt the user for an input or output washer.
Laundry._askForWasher = function(rl, job, mode, callback) {
    var validWashers = [];
    for (var i in allWashers) {
        var w = new allWashers[i]();
        if (w[mode] && w.name) {
            validWashers.push(w);
        }
    }

    validWashers.sort(function(a, b) {
        return a.name === b.name ? 0 : a.name < b.name ? -1 : 1;
    });

    var washersList = '';
    validWashers.forEach(function(washer) {
        washersList += util.format(chalk.bold("%s") + " - %s\n", washer.name, washer[mode].description);
    });

    var prompt = "Now to decide where to launder data from. The sources we have are:\n%s\n";
    var confirm = "Cool, we'll start with " + chalk.green.bold("%s") + ".";
    var question = "Which source do you want to use? ";
    if (mode === 'output') {
        prompt = "Now to decide where to send data to. The options we have are:\n%s\n\n";
        confirm = "Cool, we'll send it to " + chalk.green.bold("%s") + ".\n";
        question = "Which target do you want to use? ";
    }

    var list = util.format(prompt, washersList);
    rl.write("\n" + wrap(list, Laundry._wrapOpts));

    var washer = null;
    async.whilst(function() {
            return washer === null || washer === undefined;
        }, function(callback) {
            rl.question(wrap(question, Laundry._wrapOpts), function(answer) {
                answer = chalk.stripColor(answer).trim();
                washer = validWashers.filter(function(washer) {
                    return washer.name.toLowerCase() === answer.toLowerCase();
                })[0];
                if (washer) {
                    rl.write(wrap(util.format(confirm, washer.name), Laundry._wrapOpts) + '\n\n');
                    if (!job[mode] || job[mode].name !== washer.name) {
                        job[mode] = washer;
                    }
                } else {
                    rl.write(wrap(chalk.red("Hm, couldn't find that one. Try again?\n"), Laundry._wrapOpts));
                }
                callback();
            });
            if (job[mode]) {
                rl.write(job[mode].name);
            }
        },
        function(err) {
            callback(err);
        });
};

// Given an input or output washer, find other jobs using a similar one and inherit settings from it.
Laundry._inheritSettings = function(washer, mode) {
    var washerClass = washer.className;

    // Collect the base classes that the washer inherits from.
    var baseClasses = [];
    while (washerClass.indexOf('.') !== -1) {
        washerClass = washerClass.substr(0, washerClass.lastIndexOf('.'));
        baseClasses.push(washerClass);
    }
    baseClasses.pop();

    // Collect the settings in those base classes.
    var settings = ['token'];
    baseClasses.forEach(function(baseClass) {
        if (!allWashers[baseClass]) {
            return;
        }
        var w = new allWashers[baseClass]();
        if (w[mode]) {
            w[mode].settings.forEach(function(setting) {
                if (settings.indexOf(setting.name) === -1) {
                    settings.push(setting.name);
                }
            });
        }
    });

    // Collect the jobs which use this same washer or any of its base classes.
    var relatedJobs = laundryConfig.jobs.filter(function(job) {
        var jobClass = job[mode].className;
        return baseClasses.filter(function(baseClass) {
            return jobClass.indexOf(baseClass) !== -1;
        }).length;
    });

    // Merge settings from the related job into this new washer.
    relatedJobs.forEach(function(job) {
        settings.forEach(function(setting) {
            washer[setting] = job[mode][setting];
        });
    });
};

// Given a washer and an input/output mode, configure settings on the washer.
Laundry._configureWasher = function(rl, job, mode, callback) {
    var washer = job[mode];
    async.eachSeries(washer[mode].settings, function(item, callback) {
        var valid = false;

        if (!item.beforeEntry) {
            item.beforeEntry = function(rl, job, prompt, callback) {
                callback(true, prompt, '');
            };
        }

        if (!item.afterEntry) {
            item.afterEntry = function(rl, job, lastValue, newValue, callback) {
                callback();
            };
        }

        async.whilst(function() {
                return !valid;
            },
            function(callback) {
                // Call the beforeEntry method...
                item.beforeEntry.apply(washer, [
                    rl,
                    job,
                    item.prompt,
                    function(required, prompt, suggest) {
                        if (!required) {
                            valid = true;
                            callback();
                            return;
                        }
                        if (!suggest) {
                            suggest = '';
                        }

                        // Show the prompt...
                        rl.question(wrap(prompt + ' ', Laundry._wrapOpts), function(answer) {
                            answer = Helpers.cleanString(answer);
                            // Call the after entry method
                            item.afterEntry.apply(washer, [rl, job, washer[item.name], answer,
                                function(err, newAnswer) {
                                    if (newAnswer !== undefined) {
                                        answer = newAnswer;
                                    }

                                    if (err) {
                                        // Reject the answer
                                        rl.write(wrap(chalk.red("That's not a valid answer. Try again?\n"), Laundry._wrapOpts));
                                    } else {
                                        // Save the answer
                                        valid = true;
                                        washer[item.name] = answer;
                                    }
                                    callback();
                                }
                            ]);
                        });

                        // Default to the suggestion returned by beforeEntry, or the existing value for the property.
                        var def = '';
                        if (suggest) {
                            def = suggest;
                        } else if (washer[item.name]) {
                            def = washer[item.name];
                        }

                        rl.write(def.toString());
                    }
                ]);
            }, function(err) {
                callback(err);
            });
    }, function(err) {
        callback(err);
    });
};

Laundry._scheduleJob = function(rl, job, callback) {
    var prompt = '';
    prompt += "Now to set when this job will run.\n";
    prompt += "- Leave blank to run only when 'laundry run [job]' is called.\n";
    prompt += "- Enter a number to run after so many minutes. Entering 60 will run the job every hour.\n";
    prompt += "- Enter a time to run at a certain time every day, like '9:30' or '13:00'.\n";
    prompt += "- Enter the name of another job to run after that job runs.\n\n";
    rl.write("\n" + wrap(prompt, Laundry._wrapOpts));

    var valid = false;
    async.whilst(function() {
            return !valid;
        },
        function(callback) {
            rl.question(wrap("How do you want the job to be scheduled? ", Laundry._wrapOpts), function(answer) {
                answer = chalk.stripColor(answer).trim().toLowerCase();

                if (!answer) {
                    valid = true;
                    rl.write(wrap(util.format("This job will only be run manually.\n"), Laundry._wrapOpts));
                } else if (answer.indexOf(':') !== -1) {
                    var time = moment({
                        hour: answer.split(':')[0],
                        minute: answer.split(':')[1]
                    });
                    valid = time.isValid();
                    if (valid) {
                        answer = time.hour() + ':' + time.minute();
                        rl.write(wrap(util.format("This job will run every day at %s.\n", answer), Laundry._wrapOpts));
                    }
                } else if (!isNaN(parseInt(answer))) {
                    answer = parseInt(answer);
                    valid = answer > 0;
                    if (valid) {
                        rl.write(wrap(util.format("This job will run every %d minutes.\n", answer), Laundry._wrapOpts));
                    }
                } else {
                    if (answer !== job.name.toLowerCase()) {
                        laundryConfig.jobs.forEach(function(job) {
                            if (job.name.toLowerCase() === answer) {
                                valid = true;
                                answer = job.name;
                                rl.write(wrap(util.format("This job will run after the job " + chalk.bold("%s") + ".\n", answer), Laundry._wrapOpts));
                            }
                        });
                    }
                }

                if (valid) {
                    job.schedule = answer;
                } else {
                    rl.write(wrap(chalk.red("That's not a valid answer. Try again?\n"), Laundry._wrapOpts));
                }
                callback();
            });
            if (job.schedule) {
                rl.write(job.schedule.toString());
            }
        }, function(err) {
            callback(err, rl, job);
        });
};

// Edit an existing job.
Laundry.edit = function(jobName, callback) {
    if (!jobName) {
        console.log("Specify a job to edit with " + chalk.bold("laundry edit [job]") + ".\n");
        Laundry.list(callback);
        return;
    }

    Laundry.create(jobName, callback);
};

// Run a job.
Laundry.run = function(jobName, callback) {
    if (!jobName) {
        console.log("Specify a job to run with " + chalk.bold("laundry run [job]") + ".\n");
        Laundry.list(callback);
        return;
    }

    jobName = jobName.toLowerCase();

    async.waterfall([

        // Find the requested job.
        function(callback) {
            // Skip if it's all jobs.
            if (jobName === 'all') {
                callback(null, null);
                return;
            }

            var job = laundryConfig.jobs.filter(function(job) {
                return job.name.toLowerCase() === jobName;
            })[0];
            if (!job) {
                console.log("Job " + chalk.red.bold(jobName) + " was not found.\n");
                Laundry.list();
                callback(jobName);
            } else {
                callback(null, job);
            }
        },

        function(job, callback) {
            callback(null, job);
            return;
            // Update youtube-dl every day.
            if(moment().diff(laundryConfig.settings.ytdlupdate, 'hours') >= 24) {
                var ytdldl = path.join(__dirname, 'node_modules/youtube-dl/scripts/download.js');
                child_process.exec('node ' + ytdldl, function(err, stdout, stderr) {
                    log.info(err ? stderr : stdout);
                    if(!err) {
                        laundryConfig.settings.ytdlupdate = moment();
                    }
                    callback(null, job);
                });
            } else {
                callback(null, job);
            }
        },

        // Add any jobs which are scheduled to run after others.
        function(job, callback) {
            var runJobs = [job];

            // If all jobs, select everything that isn't scheduled to run after something else.
            if (jobName === 'all') {
                runJobs = laundryConfig.jobs.filter(function(job1) {
                    return laundryConfig.jobs.filter(function(job2) {
                        return job1.schedule.toString().toLowerCase() === job2.name.toLowerCase();
                    }).length === 0;
                });
            }

            var foundJobs = false;
            do {
                foundJobs = false;
                var runJobNames = runJobs.map(function(job, index, a) {
                    return job.name.toLowerCase();
                }); // jshint ignore:line
                laundryConfig.jobs.forEach(function(job) {
                    if (runJobs.indexOf(job) === -1) {
                        var name = job.schedule ? job.schedule.toString() : '';
                        name = name.toLowerCase();
                        var index = runJobNames.indexOf(name);
                        if (index !== -1) {
                            runJobs.splice(index + 1, 0, job);
                            foundJobs = true;
                        }
                    }
                }); // jshint ignore:line
            } while (foundJobs);
            callback(null, runJobs);
        },

        // Run all the jobs
        function(jobs, callback) {
            async.eachSeries(jobs, function(job, callback) {
                async.waterfall([

                    function(callback) {
                        log.info(job.name + "/" + job.input.name + " - input");
                        job.input.doInput(function(err, items) {
                            callback(err, job, items);
                        });
                    },

                    function(job, items, callback) {
                        log.info(job.name + "/" + job.output.name + " - output");
                        job.output.doOutput(items, function(err) {
                            callback(err, job);
                        });
                    }
                ], function(err, job) {
                    if (!err) {
                        job.lastRun = new Date();
                        Storage.saveConfig(function() {
                            callback(null, job);
                        });
                        log.info(job.name + " - complete");
                    } else {
                        log.error(job.name + " - error: " + util.inspect(err, {
                            depth: 99
                        }));
                        callback(null, job);
                    }
                });
            }, function(err) {
                callback(err);
            });
        }
    ], function(err) {
        if (callback) {
            callback(err);
        }
    });
};

// Destroy a job.
Laundry.destroy = function(jobName, callback) {
    if (!jobName) {
        console.log("Specify a job to edit with " + chalk.bold("laundry destroy [job]") + ".\n");
        Laundry.list(callback);
        return;
    }

    var job = null;

    async.waterfall([

            // Find the requested job.
            function(callback) {
                var job = laundryConfig.jobs.filter(function(j) {
                    return j.name.toLowerCase() === jobName.toLowerCase();
                })[0];
                if (!job) {
                    console.log("Job " + chalk.red.bold(jobName) + " was not found.\n");
                    Laundry.list();
                    callback(jobName);
                } else {
                    callback(null, job);
                }
            },

            // Set up the console.
            function(job, callback) {
                var rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });

                callback(null, rl, job);
            },

            // Confirm and destroy.
            function(rl, job, callback) {
                rl.question(wrap(util.format("Are you sure you want to destroy the job " + chalk.bold("%s") + "? Enter the job name again to confirm.", job.name), Laundry._wrapOpts) + "\n", function(answer) {
                    answer = chalk.stripColor(answer).trim().toLowerCase();
                    if (answer === job.name.toLowerCase() && answer === jobName.toLowerCase()) {

                        async.waterfall([
                            // Get any media files in this job.
                            function(callback) {
                                var prefix = Item.buildPrefix(job.name);
                                Storage.cacheFiles(prefix, callback);
                            },
                            // Delete media files.
                            function(cache, callback) {
                                Storage.deleteBefore(cache, new Date(), callback);
                            },
                            // Delete the job from the config.
                            function(callback) {
                                laundryConfig.jobs.splice(laundryConfig.jobs.indexOf(job), 1);
                                Storage.saveConfig(callback);
                            },
                            // Tell the user about it.
                            function(url, callback) {
                                rl.write(wrap(util.format(chalk.red("Job " + chalk.bold("%s") + " destroyed."), job.name), Laundry._wrapOpts) + "\n");
                                callback(null, rl);
                            }
                        ], function(err, rl) {
                            callback(err, rl);
                        });

                    } else {
                        rl.write(wrap(util.format(chalk.green("Job " + chalk.bold("%s") + " saved."), job.name), Laundry._wrapOpts) + "\n");
                        callback(null, rl);
                    }
                });
            }
        ],
        function(err, rl) {
            if (rl) {
                rl.write("\n");
                rl.close();
            }
            if (callback) {
                callback();
            }
        });
};

// List current jobs.
Laundry.list = function(callback) {
    var out = 'Current jobs: \n';

    if (!laundryConfig.jobs.length) {
        out = 'There are no jobs configured. Use "laundry create" to make one.';
    }

    laundryConfig.jobs.forEach(function(job) {
        if (job) {
            var schedule = job.schedule;
            if (typeof schedule === 'number') {
                out += util.format(chalk.bold("%s") + " runs every %d minutes.", job.name, schedule);
            } else if (!schedule) {
                out += util.format(chalk.bold("%s") + " runs manually.", job.name);
            } else if (schedule.indexOf(':') !== -1) {
                out += util.format(chalk.bold("%s") + " runs every day at %s.", job.name, schedule);
            } else {
                out += util.format(chalk.bold("%s") + " runs after another job called %s.", job.name, schedule);
            }
            out += '\n';
        }
    });

    console.log(out);
    if (callback) {
        callback();
    }
};

// Run jobs according to their schedule.
Laundry.tick = function(callback) {
    var now = moment();

    async.waterfall([

        // Get the jobs that are due to run on schedule
        function(callback) {

            var jobs = laundryConfig.jobs.filter(function(job) {
                if (!job.schedule) {
                    return false;
                }

                if (typeof(job.schedule) === 'number') {
                    // every n minutes
                    return !job.lastRun || now.diff(job.lastRun, 'minutes') >= job.schedule;

                } else if (job.schedule.indexOf(':') !== -1) {
                    // after a specific time
                    var time = moment({
                        hour: job.schedule.split(':')[0],
                        minute: job.schedule.split(':')[1]
                    });
                    return now.isAfter(time) && (!job.lastRun || now.diff(job.lastRun, 'days') >= 1);
                }

                return false;
            });

            callback(null, jobs);
        },

        // Run the jobs
        function(jobs, callback) {
            async.eachSeries(jobs, function(job, callback) {
                Laundry.run(job.name, callback);
            }, function(err) {
                if (!jobs.length) {
                    log.info('No jobs to run.');
                }
                callback(err);
            });
        }
    ], function(err) {
        if (err) {
            log.error(err);
        }
        if (callback) {
            callback();
        }
    });
};

module.exports = Laundry;
