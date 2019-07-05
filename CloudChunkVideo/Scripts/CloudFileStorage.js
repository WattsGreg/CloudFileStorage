var numberOfBlocks = 1;
var currentChunk = {};

(function ($) {
    $.fn.cloudFileUpload = function (options) {

        //Create our settings object (with overides)
        var settings = $.extend({}, $.fn.cloudFileUpload.defaults, options);

        //Start the upload
        $(settings.uploadButton).on('click', function (e) {

            //Reset progress bar
            $(settings.progressBar).progressbar(0);

            //Start!
            return beginUpload(settings);
        });
    };

    $.fn.cloudFileUpload.defaults = {
        progressBar: '#progressBar',
        fileControlID: 'selectFile',
        basePath: '/FileUpload',
        maxRetries: 1,
        retryAfterSeconds: 3,
        blockLength: 1048576, //1048576
        statusMessageArea: '#statusMessage',
        uploadButton: '#fileUpload'
    };

    var beginUpload = function (settings) {

        //Grab the control
        var fileControl = document.getElementById(settings.fileControlID);

        //Check files exist
        if (fileControl.files.length > 0) {

            //Start the upload for all files
            for (var i = 0; i < fileControl.files.length; i++) {
                uploadMetaData(fileControl.files[i], i, settings);
            }
        }
    };

    var uploadMetaData = function (file, index, settings) {

        //For this file, grab the size
        var size = file.size;

        //Work out the number of blocks
        numberOfBlocks = Math.ceil(file.size / settings.blockLength);

        //Grab the filename
        var name = file.name;
        
        currentChunk[name] = 1;

        //Send an ajax request with the data
        $.ajax({
            type: "POST",
            async: false,
            url: settings.basePath + "/SetMetadata?blocksCount=" + numberOfBlocks + "&fileName=" + name + "&fileSize=" + size,
        }).done(function (state) {

            //If all good, then start the upload
            if (state === true) {
                displayStatusMessage("Starting Upload (" + name + ")", settings);

                //Send the upload
                sendFile(file, settings.blockLength, settings);
            }
        }).fail(function () {
            displayStatusMessage("Failed to connect to storage. Upload cancelled.", settings, true);
        });
    };

    var sendFile = function (file, chunkSize, settings) {        

        //Vars
        var start = 0, end = Math.min(chunkSize, file.size), retryCount = 0, sendNextChunk, fileChunk;

        //Reset status message
        displayStatusMessage("", settings);

        //Chunk sending code
        sendNextChunk = function (settings) {

            //Create new chunk from form data
            fileChunk = new FormData();

            //Switcheroo on types of slice...
            if (file.slice) {
                fileChunk.append('Slice-' + file.name, file.slice(start, end));
            }
            else if (file.webkitSlice) {
                fileChunk.append('Slice' + file.name, file.webkitSlice(start, end));
            }
            else if (file.mozSlice) {
                fileChunk.append('Slice' + file.name, file.mozSlice(start, end));
            }
            else {
                //Unsupported. Pipe in settings
                displayStatusMessage(operationType.UNSUPPORTED_BROWSER, settings);
                return;
            }

            //Upload a chunk
            jqxhr = $.ajax({
                async: true,
                url: (settings.basePath + '/UploadChunk?id=' + currentChunk[file.name] + '&fileName=' + file.name),
                data: fileChunk,
                cache: false,
                contentType: false,
                processData: false,
                type: 'POST'
            }).fail(function (request, error) {

                //Something went wrong
                if (error !== 'abort' && settings.retryCount < maxRetries) {
                    ++settings.retryCount;
                    setTimeout(sendNextChunk, retryAfterSeconds * 1000);
                }

                //Upload was aborted
                if (error === 'abort') {
                    displayStatusMessage("Aborted the upload", settings, true);
                }
                else {

                    //Upload timed out
                    if (retryCount === settings.maxRetries) {
                        displayStatusMessage("Upload timed out.", settings, true);
                        resetControls();
                        uploader = null;
                    }
                    else {

                        //Resume
                        displayStatusMessage("Resuming Upload", settings);
                    }
                }

                return;
            }).done(function (notice) {

                //When done, if errorer or last block
                if (notice.error || notice.isLastBlock) {
                    displayStatusMessage(notice.message, settings);

                    if (settings.onComplete !== undefined) {
                        settings.onComplete(file.name, notice.resourceURL);
                    }

                    //Finish
                    return;
                }

                //Increment chunk
                ++currentChunk[file.name];

                //Array zero based, so for next run start at current chunk - 1 * how long each chunk is
                start = (currentChunk[file.name] - 1) * settings.blockLength;

                //End is current chunk (zero based so this is the end of next chunk) * chunk length
                end = Math.min(currentChunk[file.name] * settings.blockLength, file.size);

                //Reset retry
                retryCount = 0;

                //Move progress
                updateProgress(settings, file.name);

                //Check if need to send chunk
                if (currentChunk[file.name] <= numberOfBlocks) {
                    sendNextChunk(settings);
                }
            });
        };
        sendNextChunk(settings);
    };

    var displayStatusMessage = function (message, settings, isError) {

        if (isError === undefined) {
            isError = false;
        }

        //Check if custom event provided
        if (settings.onStatusMessage !== undefined) {
            settings.onStatusMessage(message, isError);
        }
        else {
            $(settings.statusMessageArea).text(message);
        }

    };

    var updateProgress = function (settings, fileName) {

        var progress = roundTo(currentChunk[fileName] / numberOfBlocks * 100, 2);

        //Check if custom event provided
        if (settings.onProgressUpdate !== undefined) {
            settings.onProgressUpdate(progress, fileName);
        }
        else {
            if (progress <= 100) {
                $(settings.progressBar).progressbar("option", "value", parseInt(progress));
                displayStatusMessage("Uploaded " + progress + "%", settings);
            }
        }

    };

})(jQuery);

function roundTo(n, digits) {
    var negative = false;
    if (digits === undefined) {
        digits = 0;
    }
    if (n < 0) {
        negative = true;
        n = n * -1;
    }
    var multiplicator = Math.pow(10, digits);
    n = parseFloat((n * multiplicator).toFixed(11));
    n = (Math.round(n) / multiplicator).toFixed(2);
    if (negative) {
        n = (n * -1).toFixed(2);
    }
    return n;
}

$(document).ready(function () {
    $('#fileUpload').cloudFileUpload({
        onProgressUpdate: function (progress, filename) {

            //Get a safe ID
            var targetfilename = makeSafeForCSS(filename);            

            //Get progress bar
            var progressBar = $('#progressBar-' + targetfilename);            

            //Create progress bar if doesn't exist
            if (progressBar.length == 0) {

                //Create new progress bar
                var newProgressBar = $('<div id="progressBar-' + targetfilename + '"><h3>Uploading: ' + filename + '</h3><div class="meter"><span style="width: 0%" ></span></div></div>');

                //Append
                $('#progressBars').append(newProgressBar);
            }

            //Reference
            progressBar = $('#progressBar-' + targetfilename + ' .meter span');

            //Set width
            progressBar.css({ 'width': progress + '%' });

            //If we're fully done, then we can remove the progress bar
            if (progress >= 100) {
                setTimeout(function () {
                    $('#progressBar-' + targetfilename).fadeOut().remove();
                }, 2000);
            }

        },
        onStatusMessage: function (message, isError) {

            if (message !== undefined && message != '' && message != null) {
                var alertClass = 'alert-info';
                if (isError) {
                    alertClass = 'alert-danger';
                }

                var ele = $('<div class="alert ' + alertClass + ' alert-dismissible show" role="alert">' + message + '<button type="button" class= "close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>');

                var statusMessageArea = $('#statusMessageArea');
                $(statusMessageArea).append(ele);
            }
        },
        onComplete: function (filename, resourceURL) {
            console.log(resourceURL);
        }
    });
});

function makeSafeForCSS(name) {
    return name.replace(/[^a-z0-9]/g, function (s) {
        var c = s.charCodeAt(0);
        if (c == 32) return '-';
        if (c >= 65 && c <= 90) return '_' + s.toLowerCase();
        return '__' + ('000' + c.toString(16)).slice(-4);
    });
}