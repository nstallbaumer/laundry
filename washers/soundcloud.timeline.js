'use strict';

/*
Converts media from the user's SoundCloud timeline into items.
input: none
output: none
*/
ns('Washers.SoundCloud', global);
Washers.SoundCloud.Timeline = function(config) {
    Washers.SoundCloud.call(this, config);

    this.name = 'SoundCloud/Timeline';
    this.className = Helpers.classNameFromFile(__filename);

    this.input = _.merge(this.input, {
        description: 'Loads recent sounds from your SoundCloud timeline.'
    });
};

Washers.SoundCloud.Timeline.prototype = Object.create(Washers.SoundCloud.prototype);

Washers.SoundCloud.Timeline.prototype.doInput = function(callback) {
    var that = this;
    async.waterfall([

            // Get my userid
            function(callback) {
                Helpers.jsonRequest(
                    extend({
                        uri: 'https://api.soundcloud.com/me'
                    }, that._requestOptions), function(response) {
                        callback(null, response.id);
                    }, callback);
            },

            // Paged request to get all the people I'm following
            function(userid, callback) {
                var limit = 200;
                var following = [];
                var pageLength = 0;
                async.doWhilst(function(callback) {
                        Helpers.jsonRequest(
                            extend({
                                uri: util.format('https://api.soundcloud.com/users/%d/followings', userid),
                                qs: {
                                    limit: limit,
                                    offset: following.length
                                }
                            }, that._requestOptions),
                            function(response) {
                                pageLength = response.length;
                                following = following.concat(response);
                                callback();
                            },
                            callback);
                    },
                    function() {
                        return pageLength === limit;
                    },
                    function(err) {
                        callback(err, following);
                    });
            },

            // For each person I'm following, get their recent tracks.
            function(following, callback) {
                var tracks = [];
                async.eachLimit(following, 10, function(following, callback) {
                        Helpers.jsonRequest(
                            extend({
                                uri: util.format('https://api.soundcloud.com/users/%d/tracks', following.id)
                            }, that._requestOptions),
                            function(response) {
                                tracks = tracks.concat(response);
                                callback(null, response);
                            },
                            callback);
                    },
                    function(err) {
                        callback(err, tracks);
                    });
            },

            // Sort the tracks together and return the most recent.
            function(tracks, callback) {
                tracks.sort(function(a, b) {
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                });
                tracks = tracks.slice(0, 50);
                callback(null, tracks);
            },

            // Parse the tracks into Item objects.
            function(tracks, callback) {
                var parsed = [];
                tracks.forEach(function(track, index, array) {
                    parsed.push(Items.SoundCloud.Track.factory(track, that.clientId));
                });

                callback(null, parsed);
            }

        ],
        function(err, result) {
            callback(err, result);
        });
};

module.exports = Washers.SoundCloud.Timeline;