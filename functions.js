// Datumsberechnungen
var getToday =
{
   myHumanReadable: function()
   {
      var day = new Date();
      return pad((+day.getDate()),2) + '.' + pad((+day.getMonth() + 1),2) + '.' + day.getFullYear() + ' ' +  pad((+day.getHours()),2) + ':' +  pad((+day.getMinutes()),2) + ':' +  pad((+day.getSeconds()),2) + ' ';
   },

   day: function()
   {
      var trenn = '-';
      var day = new Date();
      return day.getFullYear() + trenn + pad((+day.getMonth() + 1),2) + trenn + pad((+day.getDate()),2);
   },
};

exports.mylog = function(msg)
{
   console.log(getToday.myHumanReadable() + msg);
}

function pad(number, length)
{
    var str = '' + number;
    while (str.length < length)
    {
        str = '0' + str;
    }
    return str;
}

exports.getToday = getToday;