using System;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace LiveMapDesktop;

public partial class MainWindow : Window
{
    private WebView2 _mapWebView = null!;

    public MainWindow()
    {
        InitializeComponent();
        _mapWebView = MapWebView;
        _mapWebView.CoreWebView2InitializationCompleted += MapWebView_InitializationCompleted;
        _mapWebView.NavigationCompleted += MapWebView_NavigationCompleted;
        _mapWebView.WebMessageReceived += MapWebView_WebMessageReceived;

        Loaded += async (s, e) =>
        {
            try
            {
                await InitializeWebViewAsync();
            }
            catch (Exception ex)
            {
                UpdateStatus($"Error initializing WebView2: {ex.Message}", false);
            }
        };
    }

    private async Task InitializeWebViewAsync()
    {
        var envOptions = new CoreWebView2EnvironmentOptions("--enable-features=WebAssemblySimd", null);
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LiveMapDesktop");

        var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
        await _mapWebView.EnsureCoreWebView2Async(env);

        var htmlPath = Path.Combine(
            Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!,
            "wwwroot", "index.html");

        if (!File.Exists(htmlPath))
        {
            UpdateStatus("Error: wwwroot/index.html not found", false);
            return;
        }

        _mapWebView.CoreWebView2.Settings.AreDevToolsEnabled = true;
        _mapWebView.CoreWebView2.Settings.IsWebMessageEnabled = true;

        UpdateStatus(" Loading map...", true);
        _mapWebView.CoreWebView2.Navigate(htmlPath);
    }

    private void MapWebView_InitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            UpdateStatus($"WebView2 initialization failed: {e.InitializationException?.Message}", false);
        }
    }

    private void MapWebView_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            UpdateStatus($"Navigation failed (HTTP {(int)e.WebErrorStatus})", false);
        }
        else
        {
            UpdateStatus(" Connected - Map ready", true);
        }
    }

    private void MapWebView_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var message = e.TryGetWebMessageAsString();
            Dispatcher.Invoke(() =>
            {
                UpdateStatus($" Map: {message}", true);
            });
        }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() => UpdateStatus($" Message error: {ex.Message}", false));
        }
    }

    private async void LoadSeedButton_Click(object sender, RoutedEventArgs e)
    {
        await UpdateSeedAsync(SeedTextBox.Text);
    }

    private async void SeedTextBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            await UpdateSeedAsync(SeedTextBox.Text);
        }
    }

    public async Task UpdateSeedAsync(string seed)
    {
        if (_mapWebView?.CoreWebView2 == null)
        {
            UpdateStatus(" WebView not ready", false);
            return;
        }

        try
        {
            // Escape the seed for JavaScript
            var escapedSeed = seed.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("'", "\\'");

            var script = $"if (typeof updateSeed === 'function') {{ updateSeed(\"{escapedSeed}\"); }} else {{ console.log('updateSeed not defined'); }}";

            var result = await _mapWebView.CoreWebView2.ExecuteScriptAsync(script);
            UpdateStatus($" Seed updated: {seed}", true);
        }
        catch (Exception ex)
        {
            UpdateStatus($" Error updating seed: {ex.Message}", false);
        }
    }

    private void UpdateStatus(string message, bool isSuccess)
    {
        Dispatcher.Invoke(() =>
        {
            StatusText.Text = message;
            StatusEllipse.Fill = isSuccess ? new SolidColorBrush(Color.FromRgb(0xf0, 0xa5, 0x00)) 
                                           : new SolidColorBrush(Color.FromRgb(0xff, 0x44, 0x44));
        });
    }

    private async void CheckForUpdates_Click(object sender, RoutedEventArgs e)
    {
        UpdateStatus(" Checking for updates...", true);
        try
        {
            using var client = new System.Net.Http.HttpClient();
            client.DefaultRequestHeaders.Add("User-Agent", "LiveMapDesktop");
            var json = await client.GetStringAsync(
                "https://api.github.com/repos/JacyFleisie/Minecraft-LiveMap/releases/latest");
            var release = System.Text.Json.JsonSerializer.Deserialize<ReleaseInfo>(json);
            if (release != null && release.TagName != null)
            {
                var current = "v1.0.0";
                if (release.TagName != current)
                {
                    MessageBox.Show(this,
                        $"Update available: {release.TagName}\n\nClick Help > Check for Updates again after the app restarts to download.",
                        "Update Available",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                }
                else
                {
                    MessageBox.Show(this,
                        $"You're running the latest version ({current}).",
                        "Up to Date",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                }
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                $"Could not check for updates: {ex.Message}",
                "Update Check Failed",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private class ReleaseInfo
    {
        public string? TagName { get; set; }
        public string? Name { get; set; }
        public string? HtmlUrl { get; set; }
    }
}
