const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Configuração principal
const TIKTOK_USERNAME = 'username_aqui'; // Altere para o username desejado
const OUTPUT_DIR = './tiktok_data';
const SCROLL_DELAY = 2000; // Delay entre scrolls em ms
const MAX_SCROLLS = 50; // Máximo de scrolls para evitar loop infinito

class TikTokScraper {
    constructor(username) {
        this.username = username;
        this.browser = null;
        this.page = null;
        this.videos = [];
    }

    // Inicializa o navegador com configurações para parecer humano
    async initBrowser() {
        console.log('🚀 Iniciando navegador...');
        
        this.browser = await puppeteer.launch({
            headless: false, // Mude para true se não quiser ver o navegador
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1366,768'
            ]
        });

        this.page = await this.browser.newPage();
        
        // Simula um navegador real
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await this.page.setViewport({ width: 1366, height: 768 });
        
        // Intercepta requests para otimizar carregamento
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            // Bloqueia recursos desnecessários para acelerar
            if(req.resourceType() === 'stylesheet' || req.resourceType() === 'font' || req.resourceType() === 'image'){
                req.abort();
            } else {
                req.continue();
            }
        });
    }

    // Navega para o perfil do TikTok
    async navigateToProfile() {
        console.log(`📱 Navegando para perfil: @${this.username}`);
        
        const profileUrl = `https://www.tiktok.com/@${this.username}`;
        
        try {
            await this.page.goto(profileUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Aguarda o carregamento da página
            await this.page.waitForTimeout(3000);

            // Verifica se o perfil existe
            const isProfileValid = await this.page.evaluate(() => {
                const errorElement = document.querySelector('[data-e2e="user-post-item-list"]') || 
                                   document.querySelector('[data-e2e="user-post-item"]') ||
                                   document.querySelector('.video-feed-container');
                return !!errorElement;
            });

            if (!isProfileValid) {
                throw new Error('Perfil não encontrado ou privado');
            }

            console.log('✅ Perfil carregado com sucesso');
            
        } catch (error) {
            console.error('❌ Erro ao carregar perfil:', error.message);
            throw error;
        }
    }

    // Realiza scroll infinito para carregar todos os vídeos
    async scrollToLoadAllVideos() {
        console.log('📜 Iniciando scroll para carregar vídeos...');
        
        let scrollCount = 0;
        let previousVideoCount = 0;
        let noNewVideosCount = 0;

        while (scrollCount < MAX_SCROLLS && noNewVideosCount < 3) {
            try {
                // Conta vídeos atuais
                const currentVideoCount = await this.page.evaluate(() => {
                    const videoElements = document.querySelectorAll('[data-e2e="user-post-item"]');
                    return videoElements.length;
                });

                console.log(`📊 Vídeos carregados: ${currentVideoCount}`);

                // Se não houve novos vídeos por 3 scrolls, para
                if (currentVideoCount === previousVideoCount) {
                    noNewVideosCount++;
                } else {
                    noNewVideosCount = 0;
                }

                // Realiza o scroll
                await this.page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });

                // Aguarda carregamento
                await this.page.waitForTimeout(SCROLL_DELAY);

                previousVideoCount = currentVideoCount;
                scrollCount++;

            } catch (error) {
                console.error('⚠️ Erro durante scroll:', error.message);
                break;
            }
        }

        console.log(`✅ Scroll concluído. Total de scrolls: ${scrollCount}`);
    }

    // Extrai dados de todos os vídeos da página
    async extractVideoData() {
        console.log('🔍 Extraindo dados dos vídeos...');
        
        try {
            const videos = await this.page.evaluate(() => {
                const videoElements = document.querySelectorAll('[data-e2e="user-post-item"]');
                const extractedVideos = [];

                videoElements.forEach((element, index) => {
                    try {
                        // URL do vídeo
                        const linkElement = element.querySelector('a');
                        const videoUrl = linkElement ? linkElement.href : '';

                        // Thumbnail
                        const imgElement = element.querySelector('img');
                        const thumbnail = imgElement ? imgElement.src : '';

                        // Título/descrição (às vezes não está disponível na listagem)
                        const titleElement = element.querySelector('[data-e2e="user-post-item-desc"]') || 
                                           element.querySelector('.video-meta-caption');
                        const title = titleElement ? titleElement.textContent.trim() : `Vídeo ${index + 1}`;

                        // Estatísticas (views, likes, comentários)
                        const statsElements = element.querySelectorAll('.video-count');
                        let views = 'N/A', likes = 'N/A', comments = 'N/A';

                        // Tenta extrair estatísticas de diferentes estruturas possíveis
                        if (statsElements.length > 0) {
                            statsElements.forEach(stat => {
                                const text = stat.textContent.toLowerCase();
                                if (text.includes('k') || text.includes('m') || /^\d+$/.test(text)) {
                                    if (stat.previousElementSibling) {
                                        const icon = stat.previousElementSibling.querySelector('svg') || stat.previousElementSibling;
                                        if (icon && icon.outerHTML.includes('heart')) {
                                            likes = text;
                                        } else if (icon && icon.outerHTML.includes('comment')) {
                                            comments = text;
                                        } else {
                                            views = text;
                                        }
                                    }
                                }
                            });
                        }

                        // Busca alternativa para estatísticas
                        const strongElements = element.querySelectorAll('strong');
                        if (strongElements.length >= 2) {
                            likes = strongElements[0].textContent || 'N/A';
                            comments = strongElements[1].textContent || 'N/A';
                        }

                        if (videoUrl && thumbnail) {
                            extractedVideos.push({
                                url: videoUrl,
                                title: title,
                                thumbnail: thumbnail,
                                likes: likes,
                                comments: comments,
                                views: views,
                                extractedAt: new Date().toISOString()
                            });
                        }

                    } catch (error) {
                        console.error('Erro ao extrair vídeo:', error);
                    }
                });

                return extractedVideos;
            });

            this.videos = videos;
            console.log(`✅ ${videos.length} vídeos extraídos com sucesso`);
            
            return videos;

        } catch (error) {
            console.error('❌ Erro ao extrair dados:', error.message);
            throw error;
        }
    }

    // Cria diretório de output se não existir
    async createOutputDirectory() {
        try {
            await fs.mkdir(OUTPUT_DIR, { recursive: true });
        } catch (error) {
            console.error('Erro ao criar diretório:', error.message);
        }
    }

    // Salva dados em formato JSON
    async saveToJSON() {
        const jsonPath = path.join(OUTPUT_DIR, `${this.username}_videos.json`);
        
        try {
            const jsonData = {
                profile: this.username,
                totalVideos: this.videos.length,
                extractedAt: new Date().toISOString(),
                videos: this.videos
            };

            await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
            console.log(`💾 Dados salvos em JSON: ${jsonPath}`);
            
        } catch (error) {
            console.error('❌ Erro ao salvar JSON:', error.message);
        }
    }

    // Salva dados em formato CSV
    async saveToCSV() {
        const csvPath = path.join(OUTPUT_DIR, `${this.username}_videos.csv`);
        
        try {
            // Cabeçalho CSV
            const headers = ['URL', 'Título', 'Thumbnail', 'Likes', 'Comentários', 'Views', 'Data Extração'];
            
            // Linhas de dados
            const rows = this.videos.map(video => [
                video.url,
                `"${video.title.replace(/"/g, '""')}"`, // Escapa aspas no CSV
                video.thumbnail,
                video.likes,
                video.comments,
                video.views,
                video.extractedAt
            ]);

            // Combina cabeçalho e dados
            const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
            
            await fs.writeFile(csvPath, csvContent, 'utf8');
            console.log(`📊 Dados salvos em CSV: ${csvPath}`);
            
        } catch (error) {
            console.error('❌ Erro ao salvar CSV:', error.message);
        }
    }

    // Função principal que executa todo o processo
    async scrape() {
        try {
            console.log(`🎬 Iniciando scraping do perfil @${this.username}`);
            
            // Cria diretório de output
            await this.createOutputDirectory();
            
            // Inicializa navegador
            await this.initBrowser();
            
            // Navega para perfil
            await this.navigateToProfile();
            
            // Carrega todos os vídeos com scroll
            await this.scrollToLoadAllVideos();
            
            // Extrai dados dos vídeos
            await this.extractVideoData();
            
            // Salva em ambos os formatos
            await this.saveToJSON();
            await this.saveToCSV();
            
            console.log(`🎉 Scraping concluído! ${this.videos.length} vídeos extraídos.`);
            
        } catch (error) {
            console.error('💥 Erro geral no scraping:', error.message);
            throw error;
        } finally {
            // Fecha navegador
            if (this.browser) {
                await this.browser.close();
                console.log('🔒 Navegador fechado');
            }
        }
    }

    // Método para limpar dados antes de nova execução
    async cleanup() {
        this.videos = [];
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}

// Função principal para executar o scraper
async function main() {
    // Validação do username
    if (!TIKTOK_USERNAME || TIKTOK_USERNAME === 'username_aqui') {
        console.error('❌ Por favor, defina um username válido na variável TIKTOK_USERNAME');
        process.exit(1);
    }

    const scraper = new TikTokScraper(TIKTOK_USERNAME);

    try {
        await scraper.scrape();
        console.log('✨ Processo finalizado com sucesso!');
        
    } catch (error) {
        console.error('💀 Falha no scraping:', error.message);
        
        // Tratamento de erros específicos
        if (error.message.includes('net::ERR_INTERNET_DISCONNECTED')) {
            console.error('🌐 Verifique sua conexão com a internet');
        } else if (error.message.includes('Perfil não encontrado')) {
            console.error('👤 Username não existe ou perfil é privado');
        } else if (error.message.includes('Navigation timeout')) {
            console.error('⏰ Timeout - TikTok pode estar bloqueando requests');
        }
        
    } finally {
        await scraper.cleanup();
        process.exit(0);
    }
}

// Executa apenas se for chamado diretamente
if (require.main === module) {
    main();
}

// Exporta a classe para uso em outros arquivos
module.exports = TikTokScraper;
